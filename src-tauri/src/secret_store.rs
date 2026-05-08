use anyhow::{Context, Result};
use security_framework::passwords::{get_generic_password, set_generic_password};

const SERVICE: &str = "com.openless.realtime-input";
const ASR_API_KEY: &str = "asr_api_key";
const POLISH_API_KEY: &str = "polish_api_key";
const VOLCENGINE_ACCESS_TOKEN: &str = "volcengine_access_token";

pub fn save_sensitive_values(
    asr_key: &str,
    polish_key: &str,
    volcengine_token: &str,
) -> Result<()> {
    set_if_present(ASR_API_KEY, asr_key)?;
    set_if_present(POLISH_API_KEY, polish_key)?;
    set_if_present(VOLCENGINE_ACCESS_TOKEN, volcengine_token)?;
    Ok(())
}

pub fn resolve_asr_api_key(value: &str) -> String {
    resolve_secret(ASR_API_KEY, value)
}

pub fn resolve_polish_api_key(value: &str) -> String {
    resolve_secret(POLISH_API_KEY, value)
}

pub fn resolve_volcengine_access_token(value: &str) -> String {
    resolve_secret(VOLCENGINE_ACCESS_TOKEN, value)
}

fn set_if_present(account: &str, value: &str) -> Result<()> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(());
    }

    set_generic_password(SERVICE, account, trimmed.as_bytes())
        .with_context(|| format!("无法写入 macOS Keychain：{account}"))
}

fn resolve_secret(account: &str, fallback: &str) -> String {
    if !fallback.trim().is_empty() {
        return fallback.trim().to_string();
    }

    get_generic_password(SERVICE, account)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .unwrap_or_default()
}
