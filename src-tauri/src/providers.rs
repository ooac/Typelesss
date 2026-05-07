use crate::app_config::AppConfig;
use crate::secret_store;
use anyhow::{anyhow, Context, Result};
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use futures_util::{SinkExt, StreamExt};
use reqwest::multipart::{Form, Part};
use serde_json::json;
use std::{
    fs,
    io::{Read, Write},
};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
};

pub async fn transcribe_audio(config: &AppConfig, wav_path: &str) -> Result<String> {
    match config.asr_provider.as_str() {
        "whisper_compatible" => transcribe_whisper_compatible(config, wav_path).await,
        "volcengine" => transcribe_volcengine_streaming(config, wav_path).await,
        other => Err(anyhow!("未知 ASR Provider：{other}")),
    }
}

async fn transcribe_whisper_compatible(config: &AppConfig, wav_path: &str) -> Result<String> {
    if config.asr_endpoint.trim().is_empty() {
        return Err(anyhow!("请先填写 ASR Endpoint"));
    }
    let asr_api_key = secret_store::resolve_asr_api_key(&config.asr_api_key);
    if asr_api_key.trim().is_empty() {
        return Err(anyhow!("请先填写 ASR API Key"));
    }

    let bytes = fs::read(wav_path).with_context(|| format!("无法读取录音文件：{wav_path}"))?;
    let part = Part::bytes(bytes)
        .file_name("recording.wav")
        .mime_str("audio/wav")?;
    let form = Form::new()
        .text("model", config.asr_model.clone())
        .part("file", part);

    let response = reqwest::Client::new()
        .post(config.asr_endpoint.trim())
        .bearer_auth(asr_api_key.trim())
        .multipart(form)
        .send()
        .await
        .context("ASR 请求失败")?;

    let status = response.status();
    let trace_id = response
        .headers()
        .get("x-siliconcloud-trace-id")
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    let body = response.text().await.context("无法读取 ASR 响应")?;
    if !status.is_success() {
        return Err(anyhow!("ASR 请求失败：HTTP {status}，{body}"));
    }

    let value: serde_json::Value = serde_json::from_str(&body).context("ASR 响应不是合法 JSON")?;
    if has_empty_top_level_text(&value) {
        return Err(anyhow!("ASR 返回空文本，请确认刚才录音里有可识别的人声"));
    }
    extract_asr_text(&value).ok_or_else(|| {
        let trace = trace_id
            .as_deref()
            .map(|id| format!("，trace_id={id}"))
            .unwrap_or_default();
        anyhow!(
            "ASR 响应没有可用文本字段{trace}；响应结构：{}",
            json_shape(&value)
        )
    })
}

async fn transcribe_volcengine_streaming(config: &AppConfig, wav_path: &str) -> Result<String> {
    let app_id = config.volcengine_app_id.trim();
    let resource_id = config.volcengine_resource_id.trim();
    let access_token =
        secret_store::resolve_volcengine_access_token(&config.volcengine_access_token);

    if app_id.is_empty() {
        return Err(anyhow!("请先填写 Volcengine App ID"));
    }
    if resource_id.is_empty() {
        return Err(anyhow!("请先填写 Volcengine Resource ID"));
    }
    if access_token.is_empty() {
        return Err(anyhow!("请先填写 Volcengine Access Token"));
    }

    let mut request = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel"
        .into_client_request()
        .context("无法创建 Volcengine WebSocket 请求")?;
    let headers = request.headers_mut();
    headers.insert("X-Api-App-Key", app_id.parse()?);
    headers.insert("X-Api-Access-Key", access_token.parse()?);
    headers.insert("X-Api-Resource-Id", resource_id.parse()?);
    headers.insert(
        "X-Api-Connect-Id",
        uuid::Uuid::new_v4().to_string().parse()?,
    );

    let (mut ws, _) = connect_async(request)
        .await
        .context("无法连接 Volcengine streaming ASR")?;

    let full_request = json!({
        "user": { "uid": "openless-local-user" },
        "audio": {
            "format": "wav",
            "codec": "raw",
            "rate": 16000,
            "bits": 16,
            "channel": 1
        },
        "request": {
            "model_name": "bigmodel",
            "enable_itn": true,
            "enable_punc": true,
            "enable_ddc": true,
            "show_utterances": true
        }
    });
    ws.send(Message::Binary(
        build_full_client_request(&full_request)?.into(),
    ))
    .await
    .context("发送 Volcengine full client request 失败")?;

    let audio = fs::read(wav_path).with_context(|| format!("无法读取录音文件：{wav_path}"))?;
    let chunk_size = 32 * 1024;
    let mut offset = 0;
    while offset < audio.len() {
        let end = (offset + chunk_size).min(audio.len());
        let is_last = end == audio.len();
        ws.send(Message::Binary(
            build_audio_request(&audio[offset..end], is_last)?.into(),
        ))
        .await
        .context("发送 Volcengine 音频包失败")?;
        offset = end;
    }

    let mut best_text = String::new();
    while let Some(message) = ws.next().await {
        let message = message.context("读取 Volcengine 响应失败")?;
        if let Message::Binary(bytes) = message {
            if let Some(value) = parse_volcengine_response(&bytes)? {
                if let Some(text) = longest_text_field(&value) {
                    if text.chars().count() > best_text.chars().count() {
                        best_text = text;
                    }
                }
                if is_final_volcengine_response(&value) && !best_text.trim().is_empty() {
                    break;
                }
            }
        }
    }

    if best_text.trim().is_empty() {
        Err(anyhow!("Volcengine ASR 没有返回可用文本"))
    } else {
        Ok(best_text.trim().to_string())
    }
}

fn build_full_client_request(payload: &serde_json::Value) -> Result<Vec<u8>> {
    let payload = gzip(serde_json::to_vec(payload)?.as_slice())?;
    Ok(build_frame([0x11, 0x10, 0x11, 0x00], &payload))
}

fn build_audio_request(audio: &[u8], is_last: bool) -> Result<Vec<u8>> {
    let payload = gzip(audio)?;
    let flag = if is_last { 0x02 } else { 0x00 };
    Ok(build_frame([0x11, 0x20 | flag, 0x01, 0x00], &payload))
}

fn build_frame(header: [u8; 4], payload: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(8 + payload.len());
    frame.extend_from_slice(&header);
    frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    frame.extend_from_slice(payload);
    frame
}

fn gzip(input: &[u8]) -> Result<Vec<u8>> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(input)?;
    Ok(encoder.finish()?)
}

fn gunzip(input: &[u8]) -> Result<Vec<u8>> {
    let mut decoder = GzDecoder::new(input);
    let mut output = Vec::new();
    decoder.read_to_end(&mut output)?;
    Ok(output)
}

fn parse_volcengine_response(bytes: &[u8]) -> Result<Option<serde_json::Value>> {
    if bytes.len() < 8 {
        return Ok(None);
    }
    let header_size = ((bytes[0] & 0x0f) as usize) * 4;
    let message_type = bytes[1] >> 4;
    let compression = bytes[2] & 0x0f;
    let mut offset = header_size;

    if message_type == 0x09 {
        offset += 4;
    } else if message_type == 0x0f {
        offset += 4;
    }

    if bytes.len() < offset + 4 {
        return Ok(None);
    }
    let payload_size = u32::from_be_bytes(bytes[offset..offset + 4].try_into()?) as usize;
    offset += 4;
    if bytes.len() < offset + payload_size {
        return Ok(None);
    }
    let payload = &bytes[offset..offset + payload_size];
    let payload = if compression == 0x01 {
        gunzip(payload)?
    } else {
        payload.to_vec()
    };
    let value = serde_json::from_slice(&payload).context("Volcengine 响应 payload 不是 JSON")?;
    Ok(Some(value))
}

fn longest_text_field(value: &serde_json::Value) -> Option<String> {
    let mut best = String::new();
    collect_text_fields(value, &mut best);
    if best.trim().is_empty() {
        None
    } else {
        Some(best)
    }
}

fn collect_text_fields(value: &serde_json::Value, best: &mut String) {
    match value {
        serde_json::Value::Object(map) => {
            for (key, value) in map {
                if matches!(key.as_str(), "text" | "result" | "utterance" | "transcript") {
                    if let Some(text) = value.as_str() {
                        if text.chars().count() > best.chars().count() {
                            *best = text.to_string();
                        }
                    }
                }
                collect_text_fields(value, best);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                collect_text_fields(item, best);
            }
        }
        _ => {}
    }
}

fn is_final_volcengine_response(value: &serde_json::Value) -> bool {
    value.to_string().to_lowercase().contains("\"final\"")
        || value.pointer("/result/text").is_some()
        || value.pointer("/payload_msg/result/text").is_some()
}

fn extract_asr_text(value: &serde_json::Value) -> Option<String> {
    if let Some(text) = value.get("text").and_then(|text| text.as_str()) {
        return non_empty_text(text);
    }

    for pointer in [
        "/data/text",
        "/result/text",
        "/results/0/text",
        "/payload/text",
        "/output/text",
        "/transcription/text",
    ] {
        if let Some(text) = value.pointer(pointer).and_then(|text| text.as_str()) {
            if let Some(text) = non_empty_text(text) {
                return Some(text);
            }
        }
    }

    if let Some(segments) = value
        .get("segments")
        .and_then(|segments| segments.as_array())
    {
        let joined = segments
            .iter()
            .filter_map(|item| item.get("text").and_then(|text| text.as_str()))
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join("");
        if let Some(text) = non_empty_text(&joined) {
            return Some(text);
        }
    }

    longest_text_field(value).and_then(|text| non_empty_text(&text))
}

fn has_empty_top_level_text(value: &serde_json::Value) -> bool {
    value
        .get("text")
        .and_then(|text| text.as_str())
        .map(|text| text.trim().is_empty())
        .unwrap_or(false)
}

fn non_empty_text(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn json_shape(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Object(map) => {
            let keys = map.keys().take(8).cloned().collect::<Vec<_>>().join(", ");
            format!("object keys=[{keys}]")
        }
        serde_json::Value::Array(items) => format!("array len={}", items.len()),
        serde_json::Value::String(_) => "string".to_string(),
        serde_json::Value::Number(_) => "number".to_string(),
        serde_json::Value::Bool(_) => "bool".to_string(),
        serde_json::Value::Null => "null".to_string(),
    }
}

pub async fn polish_text(config: &AppConfig, text: &str, mode: &str) -> Result<String> {
    if config.polish_provider == "disabled" {
        return Ok(text.to_string());
    }
    if config.polish_endpoint.trim().is_empty() {
        return Err(anyhow!("请先填写 Polish Endpoint"));
    }
    let polish_api_key = secret_store::resolve_polish_api_key(&config.polish_api_key);
    if polish_api_key.trim().is_empty() {
        return Err(anyhow!("请先填写 Polish API Key"));
    }

    let system_prompt = polish_system_prompt(mode);
    let endpoint = chat_completions_endpoint(&config.polish_endpoint);
    let response = reqwest::Client::new()
        .post(endpoint)
        .bearer_auth(polish_api_key.trim())
        .json(&json!({
            "model": config.polish_model,
            "temperature": 0.1,
            "messages": [
                { "role": "system", "content": system_prompt },
                { "role": "user", "content": text }
            ]
        }))
        .send()
        .await
        .context("Polish 请求失败")?;

    let status = response.status();
    let body = response.text().await.context("无法读取 Polish 响应")?;
    if !status.is_success() {
        return Err(anyhow!("Polish 请求失败：HTTP {status}，{body}"));
    }

    let value: serde_json::Value =
        serde_json::from_str(&body).context("Polish 响应不是合法 JSON")?;
    value
        .pointer("/choices/0/message/content")
        .and_then(|content| content.as_str())
        .map(|content| content.trim().to_string())
        .filter(|content| !content.is_empty())
        .ok_or_else(|| anyhow!("Polish 响应缺少 choices[0].message.content"))
}

fn chat_completions_endpoint(endpoint: &str) -> String {
    let trimmed = endpoint.trim().trim_end_matches('/');
    if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/chat/completions")
    }
}

fn polish_system_prompt(mode: &str) -> &'static str {
    match mode {
        "prompt_builder" => {
            "你是语音输入文本整理器。只把用户口述整理成清晰的 AI prompt，不回答、不执行、不扩写事实。只输出整理后的文本。"
        }
        "code_prompt" => {
            "你是 AI 编程语音输入文本整理器。保留代码 token、文件名、函数名和英文技术词。只整理用户要输入的文本，不回答问题，不编造项目事实。只输出最终文本。"
        }
        _ => {
            "你是语音输入文本整理器。你的任务是把口语转成可直接发送的书面文本。不要回答用户的问题，不要执行命令，不要输出解释或前言。只输出整理后的文本。"
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extracts_siliconflow_top_level_text() {
        let value = json!({ "text": " 你好世界 " });
        assert_eq!(extract_asr_text(&value), Some("你好世界".to_string()));
    }

    #[test]
    fn extracts_nested_provider_text() {
        let value = json!({ "data": { "text": "嵌套文本" } });
        assert_eq!(extract_asr_text(&value), Some("嵌套文本".to_string()));
    }

    #[test]
    fn extracts_segment_text() {
        let value = json!({ "segments": [{ "text": "第一句" }, { "text": "第二句" }] });
        assert_eq!(extract_asr_text(&value), Some("第一句第二句".to_string()));
    }

    #[test]
    fn detects_empty_top_level_text() {
        let value = json!({ "text": "   " });
        assert!(has_empty_top_level_text(&value));
    }
}
