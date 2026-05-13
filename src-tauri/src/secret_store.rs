use anyhow::{Context, Result};
use security_framework::passwords::{get_generic_password, set_generic_password};

const SERVICE: &str = "com.openless.realtime-input";
const ASR_API_KEY: &str = "asr_api_key";
const POLISH_API_KEY: &str = "polish_api_key";
const VOLCENGINE_ACCESS_TOKEN: &str = "volcengine_access_token";
const TENCENT_SECRET_KEY: &str = "tencent_secret_key";

pub fn save_sensitive_values(
    asr_key: &str,
    polish_key: &str,
    volcengine_token: &str,
    tencent_secret_key: &str,
) -> Result<()> {
    set_if_present(ASR_API_KEY, asr_key)?;
    set_if_present(POLISH_API_KEY, polish_key)?;
    set_if_present(VOLCENGINE_ACCESS_TOKEN, volcengine_token)?;
    set_if_present(TENCENT_SECRET_KEY, tencent_secret_key)?;
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

pub fn resolve_tencent_secret_key(value: &str) -> String {
    resolve_secret(TENCENT_SECRET_KEY, value)
}

fn set_if_present(account: &str, value: &str) -> Result<()> {
    let trimmed = normalize_secret_value(value);
    if trimmed.is_empty() {
        return Ok(());
    }

    set_generic_password(SERVICE, account, trimmed.as_bytes())
        .with_context(|| format!("无法写入 macOS Keychain：{account}"))
}

fn resolve_secret(account: &str, fallback: &str) -> String {
    if !fallback.trim().is_empty() {
        return normalize_secret_value(fallback);
    }

    get_generic_password(SERVICE, account)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .map(|value| normalize_secret_value(&value))
        .unwrap_or_default()
}

fn normalize_secret_value(value: &str) -> String {
    let trimmed = value.trim();
    let decoded = decode_hex_if_needed(trimmed);
    let candidate = decoded.trim();
    if !candidate.contains("sk-") {
        return candidate
            .split(|ch: char| ch.is_whitespace() || matches!(ch, ',' | '，' | ';' | '；'))
            .next()
            .unwrap_or("")
            .trim()
            .to_string();
    }
    let key_start = candidate.find("sk-").unwrap_or(0);
    candidate[key_start..]
        .split(|ch: char| ch.is_whitespace() || matches!(ch, ',' | '，' | ';' | '；'))
        .next()
        .unwrap_or("")
        .trim()
        .to_string()
}

fn decode_hex_if_needed(value: &str) -> String {
    if value.len() % 2 != 0 || !value.chars().all(|ch| ch.is_ascii_hexdigit()) {
        return value.to_string();
    }

    let bytes = (0..value.len())
        .step_by(2)
        .filter_map(|idx| u8::from_str_radix(&value[idx..idx + 2], 16).ok())
        .collect::<Vec<_>>();

    match String::from_utf8(bytes) {
        Ok(decoded) if decoded.contains("sk-") => decoded,
        _ => value.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::normalize_secret_value;

    #[test]
    fn strips_accidentally_pasted_model_suffix() {
        assert_eq!(
            normalize_secret_value("sk-valid-token，FunAudioLLM/SenseVoiceSmall"),
            "sk-valid-token"
        );
    }

    #[test]
    fn decodes_security_cli_hex_output_when_needed() {
        assert_eq!(
            normalize_secret_value("736b2d76616c69642d746f6b656eefbc8c6d6f64656c"),
            "sk-valid-token"
        );
    }

    #[test]
    fn keeps_non_openai_style_secret_key() {
        assert_eq!(normalize_secret_value("abcDEF123+/=，备注"), "abcDEF123+/=");
    }
}
