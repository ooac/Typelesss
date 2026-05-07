use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};

use crate::secret_store;

const LEGACY_OPENAI_ASR_ENDPOINT: &str = "https://api.openai.com/v1/audio/transcriptions";
const LEGACY_OPENAI_ASR_MODEL: &str = "whisper-1";
const LEGACY_OPENAI_POLISH_ENDPOINT: &str = "https://api.openai.com/v1/chat/completions";
const LEGACY_OPENAI_POLISH_MODEL: &str = "gpt-4o-mini";
const DEFAULT_SILICONFLOW_ASR_ENDPOINT: &str = "https://api.siliconflow.cn/v1/audio/transcriptions";
const DEFAULT_SILICONFLOW_ASR_MODEL: &str = "FunAudioLLM/SenseVoiceSmall";
const DEFAULT_DEEPSEEK_POLISH_ENDPOINT: &str = "https://api.deepseek.com/v1";
const DEFAULT_DEEPSEEK_POLISH_MODEL: &str = "deepseek-v4-flash";
const DEFAULT_HOTKEY: &str = "Option+Space";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub asr_provider: String,
    pub asr_endpoint: String,
    pub asr_api_key: String,
    pub asr_model: String,
    pub volcengine_app_id: String,
    pub volcengine_access_token: String,
    pub volcengine_resource_id: String,
    pub polish_provider: String,
    pub polish_endpoint: String,
    pub polish_api_key: String,
    pub polish_model: String,
    pub output_mode: String,
    pub auto_insert: bool,
    #[serde(default = "default_hotkey")]
    pub hotkey: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            asr_provider: "whisper_compatible".to_string(),
            asr_endpoint: DEFAULT_SILICONFLOW_ASR_ENDPOINT.to_string(),
            asr_api_key: String::new(),
            asr_model: DEFAULT_SILICONFLOW_ASR_MODEL.to_string(),
            volcengine_app_id: String::new(),
            volcengine_access_token: String::new(),
            volcengine_resource_id: String::new(),
            polish_provider: "openai_compatible".to_string(),
            polish_endpoint: DEFAULT_DEEPSEEK_POLISH_ENDPOINT.to_string(),
            polish_api_key: String::new(),
            polish_model: DEFAULT_DEEPSEEK_POLISH_MODEL.to_string(),
            output_mode: "smart_polish".to_string(),
            auto_insert: true,
            hotkey: default_hotkey(),
        }
    }
}

pub fn load_config_from_disk() -> Result<AppConfig> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(AppConfig::default());
    }

    let content = fs::read_to_string(&path)
        .with_context(|| format!("无法读取配置文件：{}", path.display()))?;
    let mut config: AppConfig = serde_json::from_str(&content)
        .with_context(|| format!("无法解析配置文件：{}", path.display()))?;
    migrate_legacy_defaults(&mut config);
    Ok(config)
}

pub fn save_config_to_disk(config: &AppConfig) -> Result<()> {
    secret_store::save_sensitive_values(
        &config.asr_api_key,
        &config.polish_api_key,
        &config.volcengine_access_token,
    )?;

    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut safe_config = config.clone();
    safe_config.asr_api_key.clear();
    safe_config.polish_api_key.clear();
    safe_config.volcengine_access_token.clear();

    let content = serde_json::to_string_pretty(&safe_config)?;
    fs::write(&path, content).with_context(|| format!("无法写入配置文件：{}", path.display()))?;
    Ok(())
}

fn config_path() -> Result<PathBuf> {
    let dir = dirs::config_dir()
        .context("无法定位用户配置目录")?
        .join("OpenLessRealtimeInput");
    Ok(dir.join("config.json"))
}

fn migrate_legacy_defaults(config: &mut AppConfig) {
    if config.hotkey.trim().is_empty() {
        config.hotkey = default_hotkey();
    }
    if config.asr_endpoint.trim() == LEGACY_OPENAI_ASR_ENDPOINT {
        config.asr_endpoint = DEFAULT_SILICONFLOW_ASR_ENDPOINT.to_string();
    }
    if config.asr_model.trim() == LEGACY_OPENAI_ASR_MODEL {
        config.asr_model = DEFAULT_SILICONFLOW_ASR_MODEL.to_string();
    }
    if config.polish_endpoint.trim() == LEGACY_OPENAI_POLISH_ENDPOINT {
        config.polish_endpoint = DEFAULT_DEEPSEEK_POLISH_ENDPOINT.to_string();
    }
    if config.polish_model.trim() == LEGACY_OPENAI_POLISH_MODEL {
        config.polish_model = DEFAULT_DEEPSEEK_POLISH_MODEL.to_string();
    }
}

fn default_hotkey() -> String {
    DEFAULT_HOTKEY.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_only_legacy_openai_defaults() {
        let mut config = AppConfig {
            asr_endpoint: LEGACY_OPENAI_ASR_ENDPOINT.to_string(),
            asr_model: LEGACY_OPENAI_ASR_MODEL.to_string(),
            polish_endpoint: LEGACY_OPENAI_POLISH_ENDPOINT.to_string(),
            polish_model: LEGACY_OPENAI_POLISH_MODEL.to_string(),
            ..AppConfig::default()
        };

        migrate_legacy_defaults(&mut config);

        assert_eq!(config.asr_endpoint, DEFAULT_SILICONFLOW_ASR_ENDPOINT);
        assert_eq!(config.asr_model, DEFAULT_SILICONFLOW_ASR_MODEL);
        assert_eq!(config.polish_endpoint, DEFAULT_DEEPSEEK_POLISH_ENDPOINT);
        assert_eq!(config.polish_model, DEFAULT_DEEPSEEK_POLISH_MODEL);
    }

    #[test]
    fn keeps_custom_provider_values() {
        let mut config = AppConfig {
            asr_endpoint: "https://example.com/v1/audio/transcriptions".to_string(),
            asr_model: "custom-asr".to_string(),
            polish_endpoint: "https://example.com/v1".to_string(),
            polish_model: "custom-chat".to_string(),
            ..AppConfig::default()
        };

        migrate_legacy_defaults(&mut config);

        assert_eq!(
            config.asr_endpoint,
            "https://example.com/v1/audio/transcriptions"
        );
        assert_eq!(config.asr_model, "custom-asr");
        assert_eq!(config.polish_endpoint, "https://example.com/v1");
        assert_eq!(config.polish_model, "custom-chat");
    }

    #[test]
    fn fills_missing_hotkey_from_older_config() {
        let config: AppConfig = serde_json::from_value(serde_json::json!({
            "asrProvider": "whisper_compatible",
            "asrEndpoint": DEFAULT_SILICONFLOW_ASR_ENDPOINT,
            "asrApiKey": "",
            "asrModel": DEFAULT_SILICONFLOW_ASR_MODEL,
            "volcengineAppId": "",
            "volcengineAccessToken": "",
            "volcengineResourceId": "",
            "polishProvider": "openai_compatible",
            "polishEndpoint": DEFAULT_DEEPSEEK_POLISH_ENDPOINT,
            "polishApiKey": "",
            "polishModel": DEFAULT_DEEPSEEK_POLISH_MODEL,
            "outputMode": "smart_polish",
            "autoInsert": true
        }))
        .expect("older config should deserialize");

        assert_eq!(config.hotkey, DEFAULT_HOTKEY);
    }
}
