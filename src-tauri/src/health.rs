use crate::app_config::AppConfig;
use crate::local_asr;
use crate::secret_store;
use serde::Serialize;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub status: String, // healthy | degraded | down | unknown | unconfigured
    pub latency_ms: Option<u64>,
    pub message: Option<String>,
    pub checked_at: u64,
}

impl ProbeResult {
    fn now() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }

    fn unconfigured(message: &str) -> Self {
        Self {
            status: "unconfigured".to_string(),
            latency_ms: None,
            message: Some(message.to_string()),
            checked_at: Self::now(),
        }
    }

    fn unknown(message: &str) -> Self {
        Self {
            status: "unknown".to_string(),
            latency_ms: None,
            message: Some(message.to_string()),
            checked_at: Self::now(),
        }
    }

    fn healthy(latency_ms: u64) -> Self {
        Self {
            status: "healthy".to_string(),
            latency_ms: Some(latency_ms),
            message: None,
            checked_at: Self::now(),
        }
    }

    fn degraded(latency_ms: u64, message: &str) -> Self {
        Self {
            status: "degraded".to_string(),
            latency_ms: Some(latency_ms),
            message: Some(message.to_string()),
            checked_at: Self::now(),
        }
    }

    fn down(message: &str) -> Self {
        Self {
            status: "down".to_string(),
            latency_ms: None,
            message: Some(message.to_string()),
            checked_at: Self::now(),
        }
    }
}

const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

pub async fn probe_asr(config: &AppConfig) -> ProbeResult {
    match config.asr_provider.as_str() {
        "auto_optimized" => probe_auto_optimized(config).await,
        "whisper_compatible" => probe_whisper_compatible(config).await,
        "volcengine" => probe_volcengine(config),
        "tencent_realtime" => probe_tencent_realtime(config),
        "stepfun_streaming" => probe_stepfun_streaming(config),
        "local_hybrid" => probe_local_hybrid(config).await,
        other => ProbeResult::unknown(&format!("未知 ASR Provider：{other}")),
    }
}

async fn probe_auto_optimized(config: &AppConfig) -> ProbeResult {
    let started = Instant::now();
    let api_key = secret_store::resolve_asr_api_key(&config.asr_api_key);
    if !api_key.trim().is_empty() {
        return ProbeResult::unknown(
            "极速自动 ASR 会在录音时验证阿里 Paraformer，并在失败时切换候选",
        );
    }

    let local = probe_local_hybrid(config).await;
    let latency_ms = started.elapsed().as_millis() as u64;
    if local.status == "healthy" {
        ProbeResult::degraded(
            latency_ms,
            "未配置云端 ASR Key，当前会使用本地模型 fallback",
        )
    } else {
        ProbeResult::unconfigured("未配置云端 ASR Key，且本地 fallback 不可用")
    }
}

pub async fn probe_polish(config: &AppConfig) -> ProbeResult {
    if config.polish_provider == "disabled" {
        return ProbeResult::unconfigured("润色已禁用");
    }
    let endpoint = config.polish_endpoint.trim();
    if endpoint.is_empty() {
        return ProbeResult::unconfigured("未配置润色接口");
    }
    let api_key = secret_store::resolve_polish_api_key(&config.polish_api_key);
    if api_key.trim().is_empty() {
        return ProbeResult::unconfigured("未配置润色 API Key");
    }

    let url = ensure_models_url(endpoint, true);
    probe_http_get(&url, api_key.trim()).await
}

async fn probe_whisper_compatible(config: &AppConfig) -> ProbeResult {
    let endpoint = config.asr_endpoint.trim();
    if endpoint.is_empty() {
        return ProbeResult::unconfigured("未配置 ASR 接口");
    }
    let api_key = secret_store::resolve_asr_api_key(&config.asr_api_key);
    if api_key.trim().is_empty() {
        return ProbeResult::unconfigured("未配置 ASR API Key");
    }

    let url = ensure_models_url(endpoint, false);
    probe_http_get(&url, api_key.trim()).await
}

fn probe_volcengine(config: &AppConfig) -> ProbeResult {
    let app_id = config.volcengine_app_id.trim();
    let resource_id = config.volcengine_resource_id.trim();
    let token = secret_store::resolve_volcengine_access_token(&config.volcengine_access_token);
    if app_id.is_empty() || resource_id.is_empty() || token.trim().is_empty() {
        return ProbeResult::unconfigured("未配置 Volcengine 凭证");
    }
    // No public probe endpoint; report unknown rather than mistakenly down.
    ProbeResult::unknown("Volcengine 无公开探测路径")
}

fn probe_tencent_realtime(config: &AppConfig) -> ProbeResult {
    let secret_key = secret_store::resolve_tencent_secret_key(&config.tencent_secret_key);
    if config.tencent_app_id.trim().is_empty()
        || config.tencent_secret_id.trim().is_empty()
        || secret_key.trim().is_empty()
    {
        return ProbeResult::unconfigured("未配置腾讯云 AppID / SecretID / SecretKey");
    }
    ProbeResult::unknown("腾讯云实时 ASR 会在录音时建立 WebSocket 验证")
}

fn probe_stepfun_streaming(config: &AppConfig) -> ProbeResult {
    let api_key = secret_store::resolve_asr_api_key(&config.asr_api_key);
    if api_key.trim().is_empty() {
        return ProbeResult::unconfigured("未配置 StepFun ASR API Key");
    }
    ProbeResult::unknown("StepFun 实时 ASR 会在录音时建立 WebSocket 验证")
}

async fn probe_local_hybrid(_config: &AppConfig) -> ProbeResult {
    let started = Instant::now();
    let status = match local_asr::status().await {
        Ok(status) => status,
        Err(err) => return ProbeResult::down(&format!("本地 ASR 状态读取失败：{err}")),
    };
    let latency_ms = started.elapsed().as_millis() as u64;
    if status.installed && status.runtime_reachable {
        ProbeResult::healthy(latency_ms)
    } else if status.model_installed && !status.runtime_installed {
        ProbeResult::degraded(latency_ms, "本地模型已安装，但 Sherpa-ONNX runtime 不可用")
    } else if status.runtime_installed && !status.model_installed {
        ProbeResult::unconfigured("Sherpa-ONNX runtime 已安装，但当前模型未下载")
    } else {
        ProbeResult::unconfigured("本地 ASR 模型未安装")
    }
}

async fn probe_http_get(url: &str, api_key: &str) -> ProbeResult {
    let client = match reqwest::Client::builder().timeout(PROBE_TIMEOUT).build() {
        Ok(client) => client,
        Err(err) => return ProbeResult::down(&format!("client 初始化失败：{err}")),
    };

    let started = Instant::now();
    let response = client.get(url).bearer_auth(api_key).send().await;
    let latency_ms = started.elapsed().as_millis() as u64;

    match response {
        Ok(res) if res.status().is_success() => ProbeResult::healthy(latency_ms),
        Ok(res) if res.status().as_u16() == 401 || res.status().as_u16() == 403 => {
            ProbeResult::degraded(latency_ms, &format!("鉴权失败：HTTP {}", res.status()))
        }
        Ok(res) if res.status().as_u16() == 404 => {
            // /models 可能不存在，但接口本身可用
            ProbeResult::degraded(latency_ms, "接口可达但 /models 未实现")
        }
        Ok(res) => ProbeResult::degraded(latency_ms, &format!("HTTP {}", res.status())),
        Err(err) if err.is_timeout() => ProbeResult::down("请求超时（5s）"),
        Err(err) => ProbeResult::down(&err.to_string()),
    }
}

/// 把 `https://x/v1/audio/transcriptions` 或 `https://x/v1` 转为 `https://x/v1/models`。
/// `polish_friendly = true` 时也接受单纯的 base URL。
fn ensure_models_url(endpoint: &str, polish_friendly: bool) -> String {
    let trimmed = endpoint.trim().trim_end_matches('/');
    if let Some(idx) = trimmed.rfind("/v1") {
        let base = &trimmed[..idx + 3];
        return format!("{base}/models");
    }
    if polish_friendly {
        format!("{trimmed}/models")
    } else {
        // ASR endpoints typically include the full path; fall back to appending /models at the host root.
        format!("{trimmed}/models")
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatus {
    pub asr_api_key: bool,
    pub polish_api_key: bool,
    pub volcengine_access_token: bool,
    pub tencent_secret_key: bool,
}

pub fn secret_status() -> SecretStatus {
    SecretStatus {
        asr_api_key: !secret_store::resolve_asr_api_key("").is_empty(),
        polish_api_key: !secret_store::resolve_polish_api_key("").is_empty(),
        volcengine_access_token: !secret_store::resolve_volcengine_access_token("").is_empty(),
        tencent_secret_key: !secret_store::resolve_tencent_secret_key("").is_empty(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_models_url_from_audio_endpoint() {
        assert_eq!(
            ensure_models_url("https://api.siliconflow.cn/v1/audio/transcriptions", false),
            "https://api.siliconflow.cn/v1/models"
        );
    }

    #[test]
    fn derives_models_url_from_v1_base() {
        assert_eq!(
            ensure_models_url("https://api.deepseek.com/v1", true),
            "https://api.deepseek.com/v1/models"
        );
    }

    #[test]
    fn appends_models_when_no_v1_segment() {
        assert_eq!(
            ensure_models_url("https://example.com/api", true),
            "https://example.com/api/models"
        );
    }
}
