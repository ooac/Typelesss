use crate::app_config::AppConfig;
use crate::local_asr;
use crate::secret_store;
use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use futures_util::{Sink, SinkExt, StreamExt};
use reqwest::multipart::{Form, Part};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
    sync::OnceLock,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc::{self, UnboundedSender};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
};

const ASR_HTTP_TIMEOUT: Duration = Duration::from_secs(25);
const POLISH_HTTP_TIMEOUT: Duration = Duration::from_secs(8);
const ALIBABA_PARA_FORMER_ENDPOINT: &str = "wss://dashscope.aliyuncs.com/api-ws/v1/inference/";
const ALIBABA_PARA_FORMER_MODEL: &str = "paraformer-realtime-v2";
const STEPFUN_STREAM_ENDPOINT: &str = "wss://api.stepfun.com/v1/realtime/asr/stream";
const STEPFUN_STREAM_MODEL: &str = "step-asr-1.1-stream";
const REALTIME_FINAL_WAIT: Duration = Duration::from_millis(1200);

static ASR_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
static POLISH_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

pub async fn transcribe_audio(config: &AppConfig, wav_path: &str) -> Result<String> {
    let text = match config.asr_provider.as_str() {
        "auto_optimized" => transcribe_auto_optimized(config, wav_path).await,
        "whisper_compatible" => transcribe_whisper_compatible(config, wav_path).await,
        "volcengine" => transcribe_volcengine_streaming(config, wav_path).await,
        "local_hybrid" => transcribe_local_hybrid(config, wav_path).await,
        "stepfun_streaming" => Err(anyhow!(
            "StepFun 实时 ASR 未返回 final，不能走 batch 转写。请检查实时连接或切回硅基流动 fallback。"
        )),
        other => Err(anyhow!("未知 ASR Provider：{other}")),
    }?;
    text_is_usable(&text)?;
    Ok(text)
}

#[derive(Debug)]
pub enum RealtimeAsrCommand {
    Audio(Vec<i16>),
    Commit,
    Cancel,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptEventPayload {
    session_id: String,
    kind: String,
    text: String,
    provider_id: String,
    candidate_id: Option<String>,
    confidence: Option<f32>,
    is_low_information: Option<bool>,
    language: Option<String>,
    timestamp_ms: u64,
    recoverable: Option<bool>,
    error_message: Option<String>,
}

pub fn start_realtime_asr(
    app: &AppHandle,
    config: &AppConfig,
) -> Result<Option<UnboundedSender<RealtimeAsrCommand>>> {
    match config.asr_provider.as_str() {
        "auto_optimized" => {
            let api_key = secret_store::resolve_asr_api_key(&config.asr_api_key);
            if api_key.trim().is_empty() {
                Ok(None)
            } else {
                start_alibaba_paraformer_realtime_asr(app.clone(), config).map(Some)
            }
        }
        "stepfun_streaming" => start_stepfun_realtime_asr(app.clone(), config).map(Some),
        "local_hybrid" => Ok(None),
        _ => Ok(None),
    }
}

fn start_stepfun_realtime_asr(
    app: AppHandle,
    config: &AppConfig,
) -> Result<UnboundedSender<RealtimeAsrCommand>> {
    let api_key = secret_store::resolve_asr_api_key(&config.asr_api_key);
    if api_key.trim().is_empty() {
        return Err(anyhow!("请先填写 StepFun ASR API Key"));
    }

    let endpoint = realtime_endpoint_or_default(&config.asr_endpoint);
    let model = if config.asr_model.trim().is_empty() {
        STEPFUN_STREAM_MODEL.to_string()
    } else {
        config.asr_model.trim().to_string()
    };
    let session_id = uuid::Uuid::new_v4().to_string();
    let provider_id = "stepfun_streaming".to_string();
    let prompt = asr_hotword_prompt();
    let (tx, mut rx) = mpsc::unbounded_channel::<RealtimeAsrCommand>();

    tauri::async_runtime::spawn(async move {
        let result: Result<()> = async {
            let mut request = endpoint
                .into_client_request()
                .context("无法创建 StepFun 实时 ASR WebSocket 请求")?;
            request.headers_mut().insert(
                "Authorization",
                format!("Bearer {}", api_key.trim()).parse()?,
            );

            let (mut ws, _) = connect_async(request)
                .await
                .context("无法连接 StepFun 实时 ASR")?;

            let session_update = json!({
                "event_id": format!("evt_{}", uuid::Uuid::new_v4()),
                "type": "session.update",
                "session": {
                    "audio": {
                        "input": {
                            "format": {
                                "type": "pcm",
                                "codec": "pcm_s16le",
                                "rate": 16000,
                                "bits": 16,
                                "channel": 1
                            },
                            "transcription": {
                                "model": model,
                                "language": "zh",
                                "prompt": prompt,
                                "full_rerun_on_commit": true,
                                "enable_itn": true
                            }
                        }
                    }
                }
            });
            ws.send(Message::Text(session_update.to_string().into()))
                .await
                .context("发送 StepFun session.update 失败")?;

            let mut best_text = String::new();
            let mut committed_at: Option<Instant> = None;
            loop {
                let final_timeout = committed_at
                    .map(|at| REALTIME_FINAL_WAIT.saturating_sub(at.elapsed()))
                    .unwrap_or(Duration::from_secs(3600));

                tokio::select! {
                    command = rx.recv() => {
                        match command {
                            Some(RealtimeAsrCommand::Audio(samples)) => {
                                if committed_at.is_none() {
                                    let audio = pcm_i16_to_le_bytes(&samples);
                                    let append = json!({
                                        "event_id": format!("evt_{}", uuid::Uuid::new_v4()),
                                        "type": "input_audio_buffer.append",
                                        "audio": BASE64_STANDARD.encode(audio)
                                    });
                                    ws.send(Message::Text(append.to_string().into()))
                                        .await
                                        .context("发送 StepFun 音频分片失败")?;
                                }
                            }
                            Some(RealtimeAsrCommand::Commit) => {
                                if committed_at.is_none() {
                                    committed_at = Some(Instant::now());
                                    let commit = json!({
                                        "event_id": format!("evt_{}", uuid::Uuid::new_v4()),
                                        "type": "input_audio_buffer.commit"
                                    });
                                    ws.send(Message::Text(commit.to_string().into()))
                                        .await
                                        .context("发送 StepFun commit 失败")?;
                                }
                            }
                            Some(RealtimeAsrCommand::Cancel) => {
                                let _ = ws.close(None).await;
                                break;
                            }
                            None => {
                                if committed_at.is_none() {
                                    let _ = ws.close(None).await;
                                    break;
                                }
                            }
                        }
                    }
                    message = ws.next() => {
                        match message {
                            Some(Ok(Message::Text(text))) => {
                                if handle_stepfun_message(&app, &session_id, &provider_id, &text, &mut best_text)? {
                                    break;
                                }
                            }
                            Some(Ok(Message::Binary(bytes))) => {
                                if let Ok(text) = String::from_utf8(bytes.to_vec()) {
                                    if handle_stepfun_message(&app, &session_id, &provider_id, &text, &mut best_text)? {
                                        break;
                                    }
                                }
                            }
                            Some(Ok(Message::Close(_))) | None => {
                                emit_best_text_as_final(&app, &session_id, &provider_id, &best_text);
                                break;
                            }
                            Some(Ok(_)) => {}
                            Some(Err(err)) => return Err(anyhow!("读取 StepFun 实时 ASR 响应失败：{err}")),
                        }
                    }
                    _ = tokio::time::sleep(final_timeout), if committed_at.is_some() => {
                        emit_best_text_as_final(&app, &session_id, &provider_id, &best_text);
                        break;
                    }
                }
            }
            Ok(())
        }
        .await;

        if let Err(err) = result {
            emit_transcript_event(
                &app,
                &session_id,
                "error",
                "",
                &provider_id,
                Some(false),
                Some(&err.to_string()),
            );
        }
    });

    Ok(tx)
}

fn start_alibaba_paraformer_realtime_asr(
    app: AppHandle,
    config: &AppConfig,
) -> Result<UnboundedSender<RealtimeAsrCommand>> {
    let api_key = secret_store::resolve_asr_api_key(&config.asr_api_key);
    if api_key.trim().is_empty() {
        return Err(anyhow!("请先填写阿里 Paraformer ASR API Key"));
    }

    let endpoint = alibaba_realtime_endpoint_or_default(&config.asr_endpoint);
    let model = if config.asr_model.trim().is_empty() {
        ALIBABA_PARA_FORMER_MODEL.to_string()
    } else {
        config.asr_model.trim().to_string()
    };
    let session_id = uuid::Uuid::new_v4().to_string();
    let task_id = uuid::Uuid::new_v4().to_string();
    let provider_id = "alibaba_paraformer_realtime".to_string();
    let (tx, mut rx) = mpsc::unbounded_channel::<RealtimeAsrCommand>();

    tauri::async_runtime::spawn(async move {
        let result: Result<()> = async {
            let mut request = endpoint
                .into_client_request()
                .context("无法创建阿里 Paraformer WebSocket 请求")?;
            request
                .headers_mut()
                .insert("Authorization", format!("bearer {}", api_key.trim()).parse()?);

            let (mut ws, _) = connect_async(request)
                .await
                .context("无法连接阿里 Paraformer 实时 ASR")?;

            let run_task = json!({
                "header": {
                    "action": "run-task",
                    "task_id": task_id,
                    "streaming": "duplex"
                },
                "payload": {
                    "task_group": "audio",
                    "task": "asr",
                    "function": "recognition",
                    "model": model,
                    "parameters": {
                        "format": "pcm",
                        "sample_rate": 16000,
                        "disfluency_removal_enabled": false,
                        "language_hints": ["zh", "en"]
                    },
                    "input": {}
                }
            });
            ws.send(Message::Text(run_task.to_string().into()))
                .await
                .context("发送阿里 Paraformer run-task 失败")?;

            let mut task_started = false;
            let mut finish_requested = false;
            let mut pending_chunks: Vec<Vec<i16>> = Vec::new();
            let mut transcript_accumulator = RealtimeTranscriptAccumulator::default();
            let mut committed_at: Option<Instant> = None;

            loop {
                let final_timeout = committed_at
                    .map(|at| REALTIME_FINAL_WAIT.saturating_sub(at.elapsed()))
                    .unwrap_or(Duration::from_secs(3600));

                tokio::select! {
                    command = rx.recv() => {
                        match command {
                            Some(RealtimeAsrCommand::Audio(samples)) => {
                                if task_started && !finish_requested {
                                    let audio = pcm_i16_to_le_bytes(&samples);
                                    ws.send(Message::Binary(audio.into()))
                                        .await
                                        .context("发送阿里 Paraformer 音频分片失败")?;
                                } else if !finish_requested {
                                    pending_chunks.push(samples);
                                }
                            }
                            Some(RealtimeAsrCommand::Commit) => {
                                finish_requested = true;
                                if task_started {
                                    for chunk in pending_chunks.drain(..) {
                                        let audio = pcm_i16_to_le_bytes(&chunk);
                                        ws.send(Message::Binary(audio.into()))
                                            .await
                                            .context("发送阿里 Paraformer 缓存音频失败")?;
                                    }
                                    committed_at = Some(Instant::now());
                                    send_alibaba_finish_task(&mut ws, &task_id).await?;
                                }
                            }
                            Some(RealtimeAsrCommand::Cancel) => {
                                let _ = ws.close(None).await;
                                break;
                            }
                            None => {
                                if !finish_requested {
                                    let _ = ws.close(None).await;
                                    break;
                                }
                            }
                        }
                    }
                    message = ws.next() => {
                        match message {
                            Some(Ok(Message::Text(text))) => {
                                if handle_alibaba_message(
                                    &app,
                                    &session_id,
                                    &provider_id,
                                    &text,
                                    &mut transcript_accumulator,
                                    &mut task_started,
                                )? {
                                    break;
                                }
                                if task_started && !pending_chunks.is_empty() {
                                    for chunk in pending_chunks.drain(..) {
                                        let audio = pcm_i16_to_le_bytes(&chunk);
                                        ws.send(Message::Binary(audio.into()))
                                            .await
                                            .context("发送阿里 Paraformer 缓存音频失败")?;
                                    }
                                    if finish_requested && committed_at.is_none() {
                                        committed_at = Some(Instant::now());
                                        send_alibaba_finish_task(&mut ws, &task_id).await?;
                                    }
                                }
                            }
                            Some(Ok(Message::Binary(bytes))) => {
                                if let Ok(text) = String::from_utf8(bytes.to_vec()) {
                                    if handle_alibaba_message(
                                        &app,
                                        &session_id,
                                        &provider_id,
                                        &text,
                                        &mut transcript_accumulator,
                                        &mut task_started,
                                    )? {
                                        break;
                                    }
                                }
                            }
                            Some(Ok(Message::Close(_))) | None => {
                                emit_best_text_as_final(&app, &session_id, &provider_id, transcript_accumulator.best_text());
                                break;
                            }
                            Some(Ok(_)) => {}
                            Some(Err(err)) => return Err(anyhow!("读取阿里 Paraformer 响应失败：{err}")),
                        }
                    }
                    _ = tokio::time::sleep(final_timeout), if committed_at.is_some() => {
                        emit_best_text_as_final(&app, &session_id, &provider_id, transcript_accumulator.best_text());
                        break;
                    }
                }
            }
            Ok(())
        }
        .await;

        if let Err(err) = result {
            emit_transcript_event(
                &app,
                &session_id,
                "error",
                "",
                &provider_id,
                Some(true),
                Some(&err.to_string()),
            );
        }
    });

    Ok(tx)
}

async fn send_alibaba_finish_task<S>(ws: &mut S, task_id: &str) -> Result<()>
where
    S: Sink<Message> + Unpin,
    S::Error: std::error::Error + Send + Sync + 'static,
{
    let finish_task = json!({
        "header": {
            "action": "finish-task",
            "task_id": task_id,
            "streaming": "duplex"
        },
        "payload": {
            "input": {}
        }
    });
    ws.send(Message::Text(finish_task.to_string().into()))
        .await
        .context("发送阿里 Paraformer finish-task 失败")
}

fn handle_alibaba_message(
    app: &AppHandle,
    session_id: &str,
    provider_id: &str,
    text: &str,
    transcript_accumulator: &mut RealtimeTranscriptAccumulator,
    task_started: &mut bool,
) -> Result<bool> {
    let value: Value = serde_json::from_str(text).context("阿里 Paraformer 响应不是合法 JSON")?;
    let event = value
        .pointer("/header/event")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match event {
        "task-started" => {
            *task_started = true;
            Ok(false)
        }
        "result-generated" => {
            let sentence = value.pointer("/payload/output/sentence");
            let transcript = sentence
                .and_then(|sentence| sentence.get("text"))
                .and_then(Value::as_str)
                .unwrap_or_default();
            if transcript.trim().is_empty() {
                return Ok(false);
            }
            if text_is_usable(transcript).is_err() {
                return Ok(false);
            }
            let end_time = sentence
                .and_then(|sentence| sentence.get("end_time").or_else(|| sentence.get("endTime")));
            let sentence_end = sentence
                .and_then(|sentence| sentence.get("sentence_end"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let is_segment_final = end_time.is_some_and(|value| !value.is_null()) || sentence_end;
            let merged_text = transcript_accumulator.update(transcript, is_segment_final);
            let kind = if is_segment_final {
                "stable"
            } else {
                "partial"
            };
            emit_transcript_event(app, session_id, kind, &merged_text, provider_id, None, None);
            Ok(false)
        }
        "task-finished" => {
            emit_best_text_as_final(
                app,
                session_id,
                provider_id,
                transcript_accumulator.best_text(),
            );
            Ok(true)
        }
        "task-failed" => {
            let message = value
                .pointer("/header/error_message")
                .and_then(Value::as_str)
                .unwrap_or("阿里 Paraformer 实时 ASR 返回错误");
            emit_transcript_event(
                app,
                session_id,
                "error",
                "",
                provider_id,
                Some(true),
                Some(message),
            );
            Ok(true)
        }
        _ => Ok(false),
    }
}

#[derive(Default)]
struct RealtimeTranscriptAccumulator {
    committed: String,
    preview: String,
}

impl RealtimeTranscriptAccumulator {
    fn update(&mut self, transcript: &str, segment_final: bool) -> String {
        let text = transcript.trim();
        if text.is_empty() {
            return self.best_text().to_string();
        }

        let next = if self.committed.is_empty() || text.starts_with(&self.committed) {
            text.to_string()
        } else if self.preview == text || self.preview.ends_with(text) {
            self.preview.clone()
        } else {
            join_transcript_text(&self.committed, text)
        };

        self.preview = next.clone();
        if segment_final {
            self.committed = if self.committed.is_empty() || next.starts_with(&self.committed) {
                next.clone()
            } else if self.committed.ends_with(text) {
                self.committed.clone()
            } else {
                join_transcript_text(&self.committed, text)
            };
            self.preview = self.committed.clone();
        }

        next
    }

    fn best_text(&self) -> &str {
        if self.preview.trim().is_empty() {
            self.committed.as_str()
        } else {
            self.preview.as_str()
        }
    }
}

fn join_transcript_text(left: &str, right: &str) -> String {
    let left = left.trim();
    let right = right.trim();
    if left.is_empty() {
        return right.to_string();
    }
    if right.is_empty() || left.ends_with(right) {
        return left.to_string();
    }
    if right.starts_with(left) {
        return right.to_string();
    }

    let left_last = left.chars().last().unwrap_or_default();
    let right_first = right.chars().next().unwrap_or_default();
    let needs_space = left_last.is_ascii_alphanumeric() && right_first.is_ascii_alphanumeric();
    if needs_space {
        format!("{left} {right}")
    } else {
        format!("{left}{right}")
    }
}

fn emit_best_text_as_final(app: &AppHandle, session_id: &str, provider_id: &str, best_text: &str) {
    if best_text.trim().is_empty() {
        return;
    }
    if let Err(err) = text_is_usable(best_text) {
        emit_transcript_event(
            app,
            session_id,
            "error",
            "",
            provider_id,
            Some(true),
            Some(&err.to_string()),
        );
        return;
    }
    emit_transcript_event(
        app,
        session_id,
        "final",
        best_text.trim(),
        provider_id,
        None,
        None,
    );
}

fn handle_stepfun_message(
    app: &AppHandle,
    session_id: &str,
    provider_id: &str,
    text: &str,
    best_text: &mut String,
) -> Result<bool> {
    let value: Value = serde_json::from_str(text).context("StepFun 响应不是合法 JSON")?;
    let event_type = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match event_type {
        "conversation.item.input_audio_transcription.delta" => {
            if let Some(delta) = value.get("text").and_then(Value::as_str) {
                let next_text = merge_stepfun_delta(best_text, delta);
                if !next_text.trim().is_empty() {
                    *best_text = next_text;
                    if text_is_usable(best_text).is_err() {
                        return Ok(false);
                    }
                    emit_transcript_event(
                        app,
                        session_id,
                        "partial",
                        best_text,
                        provider_id,
                        None,
                        None,
                    );
                }
            }
            Ok(false)
        }
        "conversation.item.input_audio_transcription.completed" => {
            let transcript = value
                .get("transcript")
                .and_then(Value::as_str)
                .or_else(|| value.get("text").and_then(Value::as_str))
                .unwrap_or(best_text.as_str())
                .to_string();
            if !transcript.trim().is_empty() {
                if let Err(err) = text_is_usable(&transcript) {
                    emit_transcript_event(
                        app,
                        session_id,
                        "error",
                        "",
                        provider_id,
                        Some(true),
                        Some(&err.to_string()),
                    );
                    return Ok(true);
                }
                *best_text = transcript.clone();
                emit_transcript_event(
                    app,
                    session_id,
                    "final",
                    &transcript,
                    provider_id,
                    None,
                    None,
                );
            }
            Ok(true)
        }
        "error" => {
            let message = value
                .pointer("/error/message")
                .and_then(Value::as_str)
                .unwrap_or("StepFun 实时 ASR 返回错误");
            emit_transcript_event(
                app,
                session_id,
                "error",
                "",
                provider_id,
                Some(false),
                Some(message),
            );
            Ok(true)
        }
        _ => Ok(false),
    }
}

fn merge_stepfun_delta(current: &str, delta: &str) -> String {
    if delta.is_empty() {
        return current.to_string();
    }
    if current.is_empty() || delta.starts_with(current) {
        return delta.to_string();
    }
    if current.ends_with(delta) {
        return current.to_string();
    }
    format!("{current}{delta}")
}

fn emit_transcript_event(
    app: &AppHandle,
    session_id: &str,
    kind: &str,
    text: &str,
    provider_id: &str,
    recoverable: Option<bool>,
    error_message: Option<&str>,
) {
    let _ = app.emit(
        "transcript-event",
        TranscriptEventPayload {
            session_id: session_id.to_string(),
            kind: kind.to_string(),
            text: text.to_string(),
            provider_id: provider_id.to_string(),
            candidate_id: Some(provider_id.to_string()),
            confidence: None,
            is_low_information: Some(is_low_information_text(text)),
            language: Some(detect_transcript_language(text).to_string()),
            timestamp_ms: current_timestamp_ms(),
            recoverable,
            error_message: error_message.map(str::to_string),
        },
    );
}

fn current_timestamp_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn pcm_i16_to_le_bytes(samples: &[i16]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(samples.len() * 2);
    for sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    bytes
}

fn realtime_endpoint_or_default(endpoint: &str) -> String {
    let trimmed = endpoint.trim();
    if trimmed.starts_with("wss://") || trimmed.starts_with("ws://") {
        trimmed.to_string()
    } else {
        STEPFUN_STREAM_ENDPOINT.to_string()
    }
}

fn alibaba_realtime_endpoint_or_default(endpoint: &str) -> String {
    let trimmed = endpoint.trim();
    if trimmed.starts_with("wss://") || trimmed.starts_with("ws://") {
        trimmed.to_string()
    } else {
        ALIBABA_PARA_FORMER_ENDPOINT.to_string()
    }
}

fn asr_hotword_prompt() -> &'static str {
    "只识别并输出中文、英文和中英混输文本。禁止输出日语、平假名、片假名或其他语言。请准确保留编程术语：Claude Code、OpenAI Codex、Tauri、src-tauri、TranscriptEvent、ShadowBuffer、WebSocket、TypeScript、Rust、React、Vite、GPT。"
}

async fn transcribe_auto_optimized(config: &AppConfig, wav_path: &str) -> Result<String> {
    let mut errors = Vec::new();
    for candidate in auto_asr_candidates(config) {
        let result = match candidate.as_str() {
            "volcengine" => transcribe_volcengine_streaming(config, wav_path).await,
            "local_hybrid" => transcribe_local_hybrid(config, wav_path).await,
            "whisper_compatible" => transcribe_whisper_fallback(config, wav_path).await,
            "alibaba_paraformer_realtime" => Err(anyhow!(
                "阿里 Paraformer realtime 未返回 final，停止后跳过 batch 重试"
            )),
            _ => Err(anyhow!("未知自动 ASR 候选：{candidate}")),
        };
        match result.and_then(|text| validate_candidate_text(&candidate, text)) {
            Ok(text) => return Ok(text),
            Err(err) => errors.push(format!("{candidate}: {err}")),
        }
    }
    Err(anyhow!("自动 ASR 候选全部失败：{}", errors.join("；")))
}

async fn transcribe_whisper_fallback(config: &AppConfig, wav_path: &str) -> Result<String> {
    let mut fallback = config.clone();
    if fallback.asr_endpoint.trim().is_empty()
        || fallback.asr_endpoint.trim().starts_with("ws://")
        || fallback.asr_endpoint.trim().starts_with("wss://")
    {
        fallback.asr_endpoint = "https://api.siliconflow.cn/v1/audio/transcriptions".to_string();
    }
    if fallback.asr_model.trim().is_empty()
        || fallback.asr_model.trim() == ALIBABA_PARA_FORMER_MODEL
    {
        fallback.asr_model = "FunAudioLLM/SenseVoiceSmall".to_string();
    }
    transcribe_whisper_compatible(&fallback, wav_path).await
}

fn auto_asr_candidates(config: &AppConfig) -> Vec<String> {
    let configured = config
        .asr_provider_candidates
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    let mut candidates = if configured.is_empty() {
        vec![
            "alibaba_paraformer_realtime".to_string(),
            "volcengine".to_string(),
            "local_hybrid".to_string(),
            "whisper_compatible".to_string(),
        ]
    } else {
        configured
    };
    candidates.retain(|candidate| {
        if candidate == "volcengine" {
            !config.volcengine_app_id.trim().is_empty()
                && !config.volcengine_resource_id.trim().is_empty()
                && !secret_store::resolve_volcengine_access_token(&config.volcengine_access_token)
                    .trim()
                    .is_empty()
        } else if candidate == "whisper_compatible" {
            !secret_store::resolve_asr_api_key(&config.asr_api_key)
                .trim()
                .is_empty()
        } else {
            true
        }
    });
    candidates
}

fn validate_candidate_text(candidate: &str, text: String) -> Result<String> {
    text_is_usable(&text).with_context(|| format!("{candidate} 返回不可用文本"))?;
    Ok(text.trim().to_string())
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

    let started = Instant::now();
    let response = asr_client()
        .post(config.asr_endpoint.trim())
        .bearer_auth(asr_api_key.trim())
        .multipart(form)
        .send()
        .await
        .map_err(|err| {
            if err.is_timeout() {
                anyhow!("ASR 请求超时（{}s）", ASR_HTTP_TIMEOUT.as_secs())
            } else {
                anyhow!("ASR 请求失败：{err}")
            }
        })?;
    eprintln!(
        "ASR request finished in {}ms",
        started.elapsed().as_millis()
    );

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

async fn transcribe_local_hybrid(config: &AppConfig, wav_path: &str) -> Result<String> {
    let _ = config;
    local_asr::transcribe_wav(PathBuf::from(wav_path)).await
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
    let started = Instant::now();
    let response = polish_client()
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
        .map_err(|err| {
            if err.is_timeout() {
                anyhow!("Polish 请求超时（{}s）", POLISH_HTTP_TIMEOUT.as_secs())
            } else {
                anyhow!("Polish 请求失败：{err}")
            }
        })?;
    eprintln!(
        "Polish request finished in {}ms",
        started.elapsed().as_millis()
    );

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
        .or_else(|| {
            eprintln!("Polish response has no usable content, falling back to normalized text");
            Some(text.to_string())
        })
        .ok_or_else(|| anyhow!("Polish 响应缺少 choices[0].message.content"))
}

fn asr_client() -> &'static reqwest::Client {
    ASR_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(ASR_HTTP_TIMEOUT)
            .pool_idle_timeout(Duration::from_secs(90))
            .build()
            .expect("ASR client 初始化失败")
    })
}

fn polish_client() -> &'static reqwest::Client {
    POLISH_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(POLISH_HTTP_TIMEOUT)
            .pool_idle_timeout(Duration::from_secs(90))
            .build()
            .expect("Polish client 初始化失败")
    })
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

fn ensure_supported_transcript_language(text: &str) -> Result<()> {
    let unsupported_count = text
        .chars()
        .filter(|ch| is_japanese_kana(*ch) || is_hangul(*ch))
        .count();
    if unsupported_count == 0 {
        return Ok(());
    }
    let meaningful_count = text
        .chars()
        .filter(|ch| ch.is_alphanumeric() || is_cjk(*ch) || is_japanese_kana(*ch) || is_hangul(*ch))
        .count()
        .max(1);
    let unsupported_ratio = unsupported_count as f64 / meaningful_count as f64;
    if unsupported_count >= 2 && unsupported_ratio >= 0.12 {
        return Err(anyhow!(
            "ASR 输出疑似非中英文本，已阻止自动插入。当前只支持中文、英文和中英混输，请重试或切换硅基流动引擎。"
        ));
    }
    Ok(())
}

fn text_is_usable(text: &str) -> Result<()> {
    ensure_supported_transcript_language(text)?;
    if is_low_information_text(text) {
        return Err(anyhow!("ASR 只返回低信息文本，已阻止自动插入"));
    }
    Ok(())
}

fn is_low_information_text(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return true;
    }
    let meaningful = trimmed
        .chars()
        .filter(|ch| ch.is_alphanumeric() || is_cjk(*ch))
        .count();
    meaningful == 0 || (meaningful == 1 && trimmed.chars().count() <= 2)
}

fn detect_transcript_language(text: &str) -> &'static str {
    let has_cjk = text.chars().any(is_cjk);
    let has_ascii = text.chars().any(|ch| ch.is_ascii_alphabetic());
    match (has_cjk, has_ascii) {
        (true, true) => "mixed",
        (true, false) => "zh",
        (false, true) => "en",
        _ => "auto",
    }
}

fn is_japanese_kana(ch: char) -> bool {
    ('\u{3040}'..='\u{30ff}').contains(&ch) || ('\u{31f0}'..='\u{31ff}').contains(&ch)
}

fn is_hangul(ch: char) -> bool {
    ('\u{1100}'..='\u{11ff}').contains(&ch)
        || ('\u{3130}'..='\u{318f}').contains(&ch)
        || ('\u{ac00}'..='\u{d7af}').contains(&ch)
}

fn is_cjk(ch: char) -> bool {
    ('\u{3400}'..='\u{9fff}').contains(&ch)
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

    #[test]
    fn rejects_japanese_kana_transcript() {
        assert!(ensure_supported_transcript_language("このクラウド？ 我要用ク的 GPT。").is_err());
        assert!(ensure_supported_transcript_language("我要用 Claude Code 和 GPT。").is_ok());
    }

    #[test]
    fn rejects_hangul_transcript() {
        assert!(ensure_supported_transcript_language("달 많아 달 많아.").is_err());
        assert!(ensure_supported_transcript_language("太慢了，太慢了。").is_ok());
    }

    #[test]
    fn rejects_low_information_transcript() {
        assert!(text_is_usable("。").is_err());
        assert!(text_is_usable("").is_err());
        assert!(text_is_usable("能不能再快一点").is_ok());
    }

    #[test]
    fn detects_mixed_transcript_language() {
        assert_eq!(detect_transcript_language("我要使用 Claude Code"), "mixed");
        assert_eq!(detect_transcript_language("能不能再快一点"), "zh");
        assert_eq!(detect_transcript_language("Claude Code"), "en");
    }

    #[test]
    fn merges_stepfun_cumulative_or_incremental_delta() {
        assert_eq!(merge_stepfun_delta("", "你好"), "你好");
        assert_eq!(merge_stepfun_delta("你好", "你好世界"), "你好世界");
        assert_eq!(merge_stepfun_delta("你好", "，世界"), "你好，世界");
        assert_eq!(merge_stepfun_delta("你好", "好"), "你好");
    }

    #[test]
    fn accumulates_alibaba_segment_transcripts() {
        let mut acc = RealtimeTranscriptAccumulator::default();

        assert_eq!(acc.update("请帮我把这段话", false), "请帮我把这段话");
        assert_eq!(
            acc.update("请帮我把这段话整理得", true),
            "请帮我把这段话整理得"
        );
        assert_eq!(acc.update("继续快。", true), "请帮我把这段话整理得继续快。");
        assert_eq!(acc.best_text(), "请帮我把这段话整理得继续快。");
    }

    #[test]
    fn accepts_cumulative_alibaba_transcripts_without_duplication() {
        let mut acc = RealtimeTranscriptAccumulator::default();

        assert_eq!(
            acc.update("我要使用 Claude Code", true),
            "我要使用 Claude Code"
        );
        assert_eq!(
            acc.update("我要使用 Claude Code 和 OpenAI Codex", true),
            "我要使用 Claude Code 和 OpenAI Codex"
        );
        assert_eq!(acc.best_text(), "我要使用 Claude Code 和 OpenAI Codex");
    }
}
