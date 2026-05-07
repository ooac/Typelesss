use accessibility_sys::{
    error_string, kAXErrorSuccess, kAXFocusedUIElementAttribute, kAXSelectedTextAttribute,
    kAXTrustedCheckOptionPrompt, AXIsProcessTrusted, AXIsProcessTrustedWithOptions,
    AXUIElementCopyAttributeValue, AXUIElementCreateSystemWide, AXUIElementRef,
    AXUIElementSetAttributeValue,
};
use anyhow::{anyhow, Context, Result};
use arboard::Clipboard;
use core_foundation::{base::CFTypeRef, boolean::CFBoolean, dictionary::CFDictionary};
use core_foundation::{
    base::{CFRelease, TCFType},
    string::CFString,
};
use std::{process::Command, thread, time::Duration};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InsertTarget {
    pub pid: u32,
    pub app_name: String,
}

pub fn copy_text(text: &str) -> Result<()> {
    let mut clipboard = Clipboard::new().context("无法访问剪贴板")?;
    clipboard
        .set_text(text.to_string())
        .context("无法写入剪贴板")
}

pub fn request_accessibility_permission() -> bool {
    unsafe {
        let prompt_key = CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt);
        let prompt_value = CFBoolean::true_value();
        let options = CFDictionary::from_CFType_pairs(&[(prompt_key, prompt_value)]);
        AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef())
    }
}

pub fn has_accessibility_permission() -> bool {
    unsafe { AXIsProcessTrusted() }
}

pub fn capture_insert_target() -> Result<Option<InsertTarget>> {
    let output = Command::new("osascript")
        .args([
            "-e",
            r#"tell application "System Events" to set frontApp to first application process whose frontmost is true"#,
            "-e",
            r#"tell application "System Events" to return (unix id of frontApp as text) & linefeed & (name of frontApp as text)"#,
        ])
        .output()
        .context("无法记录当前输入框所在 App。请给 OpenLess Realtime Input 授权辅助功能权限")?;

    if !output.status.success() {
        return Ok(None);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_insert_target(&stdout)
}

pub fn paste_text(text: &str, target: Option<&InsertTarget>) -> Result<String> {
    let mut target_message = String::new();
    if let Some(insert_target) = target {
        match activate_insert_target(insert_target) {
            Ok(()) => {
                target_message = format!("已切回 {}。", insert_target.app_name);
                thread::sleep(Duration::from_millis(180));
            }
            Err(err) => {
                eprintln!("failed to activate insert target: {err}");
            }
        }
    }

    if let Err(err) = paste_via_accessibility(text) {
        eprintln!("AX insert failed, fallback to clipboard paste: {err}");
    } else {
        return Ok(format!("{target_message}已通过辅助功能插入当前光标。"));
    }

    let mut clipboard = Clipboard::new().context("无法访问剪贴板")?;
    let previous = clipboard.get_text().ok();
    clipboard
        .set_text(text.to_string())
        .context("无法写入剪贴板")?;

    let status = Command::new("osascript")
        .args([
            "-e",
            r#"tell application "System Events" to keystroke "v" using command down"#,
        ])
        .status()
        .context("无法调用系统粘贴命令")?;

    thread::sleep(Duration::from_millis(220));

    if status.success() {
        if let Some(previous_text) = previous {
            let _ = clipboard.set_text(previous_text);
        }
        Ok(format!("{target_message}已通过剪贴板粘贴到当前光标。"))
    } else {
        Err(anyhow!(
            "自动粘贴失败，文本已复制到剪贴板。请在系统设置中给 OpenLess Realtime Input 授权辅助功能权限，或手动按 Command+V。"
        ))
    }
}

fn activate_insert_target(target: &InsertTarget) -> Result<()> {
    let script = format!(
        r#"tell application "System Events" to set frontmost of first application process whose unix id is {} to true"#,
        target.pid
    );
    let status = Command::new("osascript")
        .args(["-e", &script])
        .status()
        .context("无法切回录音前的输入 App")?;

    if status.success() {
        Ok(())
    } else {
        Err(anyhow!("无法切回 {}", target.app_name))
    }
}

fn parse_insert_target(stdout: &str) -> Result<Option<InsertTarget>> {
    let mut lines = stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty());
    let Some(pid_text) = lines.next() else {
        return Ok(None);
    };
    let pid = pid_text
        .parse::<u32>()
        .context("前台 App 进程 ID 解析失败")?;
    let app_name = lines.next().unwrap_or("当前 App").to_string();

    if pid == std::process::id() {
        return Ok(None);
    }

    Ok(Some(InsertTarget { pid, app_name }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_insert_target_from_osascript_output() {
        assert_eq!(
            parse_insert_target("1234\nTextEdit\n").unwrap(),
            Some(InsertTarget {
                pid: 1234,
                app_name: "TextEdit".to_string()
            })
        );
    }

    #[test]
    fn ignores_empty_insert_target_output() {
        assert_eq!(parse_insert_target("").unwrap(), None);
    }
}

fn paste_via_accessibility(text: &str) -> Result<()> {
    if !unsafe { AXIsProcessTrusted() } {
        request_accessibility_permission();
        return Err(anyhow!("尚未获得辅助功能权限"));
    }

    unsafe {
        let system = AXUIElementCreateSystemWide();
        if system.is_null() {
            return Err(anyhow!("无法创建系统 Accessibility 元素"));
        }

        let focused_attr = CFString::new(kAXFocusedUIElementAttribute);
        let mut focused: CFTypeRef = std::ptr::null();
        let copy_error =
            AXUIElementCopyAttributeValue(system, focused_attr.as_concrete_TypeRef(), &mut focused);
        CFRelease(system as CFTypeRef);

        if copy_error != kAXErrorSuccess || focused.is_null() {
            return Err(anyhow!(
                "无法获取当前 focused element：{}",
                error_string(copy_error)
            ));
        }

        let selected_text_attr = CFString::new(kAXSelectedTextAttribute);
        let replacement = CFString::new(text);
        let set_error = AXUIElementSetAttributeValue(
            focused as AXUIElementRef,
            selected_text_attr.as_concrete_TypeRef(),
            replacement.as_concrete_TypeRef() as CFTypeRef,
        );
        CFRelease(focused);

        if set_error == kAXErrorSuccess {
            Ok(())
        } else {
            Err(anyhow!(
                "focused element 不支持 AXSelectedText 插入：{}",
                error_string(set_error)
            ))
        }
    }
}
