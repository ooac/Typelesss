use accessibility_sys::{
    kAXTrustedCheckOptionPrompt, AXIsProcessTrusted, AXIsProcessTrustedWithOptions,
};
use anyhow::{anyhow, Context, Result};
use arboard::Clipboard;
use core_foundation::{
    base::TCFType, boolean::CFBoolean, dictionary::CFDictionary, string::CFString,
};
use std::{
    process::{Command, ExitStatus, Stdio},
    thread,
    time::{Duration, Instant},
};

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
        .context("无法记录当前输入框所在 App。请给 Typelesss 授权辅助功能权限")?;

    if !output.status.success() {
        return Ok(None);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_insert_target(&stdout)
}

pub fn paste_text(text: &str, target: Option<&InsertTarget>) -> Result<String> {
    let mut target_message = String::new();
    let mut clipboard = Clipboard::new().context("无法访问剪贴板")?;
    clipboard
        .set_text(text.to_string())
        .context("无法写入剪贴板")?;

    if let Some(insert_target) = target {
        match activate_insert_target(insert_target) {
            Ok(()) => {
                target_message = format!("已切回 {}。", insert_target.app_name);
            }
            Err(err) => {
                return Err(anyhow!(
                    "自动粘贴失败：无法切回 {}，文本已复制到剪贴板。{err}",
                    insert_target.app_name
                ));
            }
        }
    }

    let mut command = Command::new("osascript");
    command.args(["-e", &clipboard_paste_script(target)]);
    let status = command_status_with_timeout(&mut command, Duration::from_secs(3))
        .context("无法调用系统粘贴命令")?;

    if status.success() {
        eprintln!("clipboard paste command succeeded");
        Ok(format!("{target_message}已通过剪贴板粘贴到当前光标。"))
    } else {
        Err(anyhow!(
            "自动粘贴失败，文本已保留在剪贴板。请在目标输入框手动按 Command+V。"
        ))
    }
}

fn clipboard_paste_script(target: Option<&InsertTarget>) -> String {
    let mut lines = Vec::new();
    if let Some(insert_target) = target {
        lines.push(format!(
            r#"tell application "System Events" to set frontmost of first application process whose unix id is {} to true"#,
            insert_target.pid
        ));
        lines.push("delay 0.05".to_string());
    }
    lines.push(r#"tell application "System Events" to key code 9 using command down"#.to_string());
    lines.join("\n")
}

fn activate_insert_target(target: &InsertTarget) -> Result<()> {
    let script = format!(
        r#"tell application "System Events" to set frontmost of first application process whose unix id is {} to true"#,
        target.pid
    );
    let mut command = Command::new("osascript");
    command.args(["-e", &script]);
    let status = command_status_with_timeout(&mut command, Duration::from_secs(2))
        .context("无法切回录音前的输入 App")?;

    if status.success() {
        wait_for_frontmost(target)
    } else {
        Err(anyhow!("无法切回 {}", target.app_name))
    }
}

fn wait_for_frontmost(target: &InsertTarget) -> Result<()> {
    for _ in 0..10 {
        thread::sleep(Duration::from_millis(80));
        if frontmost_pid().ok() == Some(target.pid) {
            return Ok(());
        }
    }

    Err(anyhow!("无法确认已切回 {}", target.app_name))
}

fn frontmost_pid() -> Result<u32> {
    let mut command = Command::new("osascript");
    command.args([
        "-e",
        r#"tell application "System Events" to return unix id of first application process whose frontmost is true"#,
    ]);
    let output = command_output_with_timeout(&mut command, Duration::from_secs(2))
        .context("无法读取当前前台 App")?;

    if !output.status.success() {
        return Err(anyhow!("无法读取当前前台 App"));
    }

    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<u32>()
        .context("当前前台 App 进程 ID 解析失败")
}

fn command_status_with_timeout(command: &mut Command, timeout: Duration) -> Result<ExitStatus> {
    let mut child = command.spawn().context("系统命令启动失败")?;
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait().context("系统命令状态读取失败")? {
            return Ok(status);
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(anyhow!("系统命令超时（{}ms）", timeout.as_millis()));
        }
        thread::sleep(Duration::from_millis(40));
    }
}

fn command_output_with_timeout(
    command: &mut Command,
    timeout: Duration,
) -> Result<std::process::Output> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().context("系统命令启动失败")?;
    let started = Instant::now();
    loop {
        if child.try_wait().context("系统命令状态读取失败")?.is_some() {
            return child.wait_with_output().context("系统命令输出读取失败");
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(anyhow!("系统命令超时（{}ms）", timeout.as_millis()));
        }
        thread::sleep(Duration::from_millis(40));
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

    #[test]
    fn clipboard_paste_script_reactivates_target_before_paste() {
        let script = clipboard_paste_script(Some(&InsertTarget {
            pid: 1234,
            app_name: "TextEdit".to_string(),
        }));

        assert!(script.contains("unix id is 1234"));
        assert!(script.contains("key code 9 using command down"));
    }
}
