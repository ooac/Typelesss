mod app_config;
mod insertion;
mod modifier_hotkey;
mod providers;
mod recorder;
mod secret_store;

use app_config::{load_config_from_disk, save_config_to_disk, AppConfig};
use insertion::InsertTarget;
use modifier_hotkey::{ModifierHotkeyState, RIGHT_OPTION_HOTKEY};
use recorder::{Recorder, RecordingResult};
use serde_json::Value;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

struct AppState {
    recorder: Mutex<Recorder>,
    insert_target: Mutex<Option<InsertTarget>>,
    hotkey: Arc<Mutex<String>>,
    modifier_hotkey: ModifierHotkeyState,
}

#[tauri::command]
fn load_config() -> Result<AppConfig, String> {
    load_config_from_disk().map_err(|err| err.to_string())
}

#[tauri::command]
fn save_config(
    app: AppHandle,
    state: tauri::State<AppState>,
    mut config: AppConfig,
) -> Result<String, String> {
    let hotkey = register_hotkey(&app, &state, &config.hotkey)?;
    config.hotkey = hotkey.clone();
    save_config_to_disk(&config).map_err(|err| err.to_string())?;
    Ok(hotkey)
}

#[tauri::command]
fn start_recording(state: tauri::State<AppState>) -> Result<(), String> {
    let insert_target = insertion::capture_insert_target()
        .map_err(|err| {
            eprintln!("failed to capture insert target: {err}");
            err
        })
        .ok()
        .flatten();
    *state
        .insert_target
        .lock()
        .map_err(|_| "插入目标状态锁定失败".to_string())? = insert_target;

    state
        .recorder
        .lock()
        .map_err(|_| "录音状态锁定失败".to_string())?
        .start()
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn stop_recording(state: tauri::State<AppState>) -> Result<RecordingResult, String> {
    state
        .recorder
        .lock()
        .map_err(|_| "录音状态锁定失败".to_string())?
        .stop()
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn cancel_recording(state: tauri::State<AppState>) -> Result<(), String> {
    state
        .recorder
        .lock()
        .map_err(|_| "录音状态锁定失败".to_string())?
        .cancel();
    *state
        .insert_target
        .lock()
        .map_err(|_| "插入目标状态锁定失败".to_string())? = None;
    Ok(())
}

#[tauri::command]
async fn transcribe_audio(config: AppConfig, wav_path: String) -> Result<String, String> {
    providers::transcribe_audio(&config, &wav_path)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn polish_text(config: AppConfig, text: String, mode: String) -> Result<String, String> {
    providers::polish_text(&config, &text, &mode)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn paste_text(state: tauri::State<AppState>, text: String) -> Result<String, String> {
    let insert_target = state
        .insert_target
        .lock()
        .map_err(|_| "插入目标状态锁定失败".to_string())?
        .take();
    insertion::paste_text(&text, insert_target.as_ref()).map_err(|err| err.to_string())
}

#[tauri::command]
fn copy_text(text: String) -> Result<(), String> {
    insertion::copy_text(&text).map_err(|err| err.to_string())
}

#[tauri::command]
fn update_capsule(app: tauri::AppHandle, payload: Value) -> Result<(), String> {
    app.emit_to("capsule", "capsule-state", payload)
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn open_input_monitoring_settings() -> Result<(), String> {
    open_system_settings(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
        "无法打开系统设置，请手动打开系统设置 > 隐私与安全性 > 输入监控。",
    )
}

#[tauri::command]
fn open_accessibility_settings() -> Result<(), String> {
    let _ = insertion::request_accessibility_permission();
    open_system_settings(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        "无法打开系统设置，请手动打开系统设置 > 隐私与安全性 > 辅助功能。",
    )
}

#[tauri::command]
fn install_to_applications_and_open_input_monitoring() -> Result<String, String> {
    let source_app = current_app_bundle_path()?;
    let target_app = PathBuf::from("/Applications/OpenLess Realtime Input.app");
    if same_path(&source_app, &target_app) {
        let _ = open_input_monitoring_settings();
        let _ = open_accessibility_settings();
        return Ok(
            "当前 App 已在 /Applications。已打开输入监控和辅助功能授权页，请勾选 OpenLess Realtime Input 后重启 App。"
                .to_string(),
        );
    }

    if target_app.exists() {
        let status = Command::new("rm")
            .arg("-rf")
            .arg(&target_app)
            .status()
            .map_err(|err| format!("无法替换 /Applications 中的旧 App：{err}"))?;
        if !status.success() {
            return Err("无法替换 /Applications 中的旧 App。请关闭旧 App 后重试。".to_string());
        }
    }

    let status = Command::new("ditto")
        .arg(&source_app)
        .arg(&target_app)
        .status()
        .map_err(|err| format!("无法复制 App 到 /Applications：{err}"))?;
    if !status.success() {
        return Err(
            "无法安装到 /Applications。请确认当前用户有写入应用程序文件夹的权限。".to_string(),
        );
    }

    let _ = Command::new("open").arg("-R").arg(&target_app).status();
    let _ = open_input_monitoring_settings();
    let _ = open_accessibility_settings();
    Ok("已安装到 /Applications。请在输入监控和辅助功能中添加或允许 OpenLess Realtime Input，然后从应用程序文件夹重启 App。".to_string())
}

fn current_app_bundle_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|err| format!("无法定位当前 App：{err}"))?;
    let app = exe
        .ancestors()
        .find(|path| path.extension().and_then(|value| value.to_str()) == Some("app"))
        .ok_or_else(|| {
            "当前程序不是从 .app 包中运行，无法自动安装。请先运行 release .app。".to_string()
        })?;
    Ok(app.to_path_buf())
}

fn same_path(left: &std::path::Path, right: &std::path::Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

fn open_system_settings(url: &str, fallback_message: &str) -> Result<(), String> {
    Command::new("open")
        .arg(url)
        .status()
        .map_err(|err| format!("无法打开系统设置：{err}"))
        .and_then(|status| {
            if status.success() {
                Ok(())
            } else {
                Err(fallback_message.to_string())
            }
        })
}

fn register_hotkey(app: &AppHandle, state: &AppState, hotkey: &str) -> Result<String, String> {
    let hotkey = normalize_hotkey(hotkey)?;
    let mut current = state
        .hotkey
        .lock()
        .map_err(|_| "快捷键状态锁定失败".to_string())?;
    if *current == hotkey {
        return Ok(hotkey);
    }

    let previous = current.clone();

    if hotkey == RIGHT_OPTION_HOTKEY {
        if let Err(err) = state
            .modifier_hotkey
            .ensure_right_option_monitor(app.clone())
        {
            eprintln!("Right Option saved but not active yet: {err}");
            let _ = open_input_monitoring_settings();
            *current = hotkey.clone();
            return Ok(hotkey);
        }
        if !previous.is_empty() && previous != RIGHT_OPTION_HOTKEY {
            let _ = app.global_shortcut().unregister(previous.as_str());
        }
        *current = hotkey.clone();
        return Ok(hotkey);
    }

    if !previous.is_empty() && previous != RIGHT_OPTION_HOTKEY {
        let _ = app.global_shortcut().unregister(previous.as_str());
    }

    match app.global_shortcut().register(hotkey.as_str()) {
        Ok(()) => {
            *current = hotkey.clone();
            Ok(hotkey)
        }
        Err(err) => {
            if !previous.is_empty() && previous != RIGHT_OPTION_HOTKEY {
                let _ = app.global_shortcut().register(previous.as_str());
            }
            Err(format!("快捷键注册失败：{err}"))
        }
    }
}

fn normalize_hotkey(hotkey: &str) -> Result<String, String> {
    let parts = hotkey
        .split('+')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(normalize_hotkey_part)
        .collect::<Vec<_>>();

    if parts.is_empty() {
        return Err("快捷键格式无效，请点击输入框后按一个键，或按组合键。".to_string());
    }

    Ok(parts.join("+"))
}

fn normalize_hotkey_part(part: &str) -> String {
    match part.to_lowercase().as_str() {
        "cmd" | "command" | "meta" | "⌘" => "Command".to_string(),
        "ctrl" | "control" | "⌃" => "Control".to_string(),
        "opt" | "option" | "alt" | "⌥" => "Option".to_string(),
        "rightoption" | "right option" | "rightalt" | "right alt" | "altright" | "optionright" => {
            RIGHT_OPTION_HOTKEY.to_string()
        }
        "shift" | "⇧" => "Shift".to_string(),
        "space" => "Space".to_string(),
        "esc" | "escape" => "Escape".to_string(),
        "return" | "enter" => "Enter".to_string(),
        other if other.len() == 1 => other.to_uppercase(),
        _ => part.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;
    use tauri_plugin_global_shortcut::Shortcut;

    #[test]
    fn accepts_single_key_hotkey() {
        assert_eq!(normalize_hotkey("d"), Ok("D".to_string()));
        assert!(Shortcut::from_str("D").is_ok());
    }

    #[test]
    fn accepts_single_function_key_hotkey() {
        assert_eq!(normalize_hotkey("F9"), Ok("F9".to_string()));
        assert!(Shortcut::from_str("F9").is_ok());
    }

    #[test]
    fn accepts_modifier_hotkey() {
        assert_eq!(
            normalize_hotkey("ctrl + alt + d"),
            Ok("Control+Option+D".to_string())
        );
        assert!(Shortcut::from_str("Control+Option+D").is_ok());
    }

    #[test]
    fn accepts_right_option_modifier_hotkey() {
        assert_eq!(
            normalize_hotkey("RightOption"),
            Ok(RIGHT_OPTION_HOTKEY.to_string())
        );
        assert_eq!(
            normalize_hotkey("right option"),
            Ok(RIGHT_OPTION_HOTKEY.to_string())
        );
    }
}

pub fn run() {
    let global_shortcut_plugin = tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                let _ = app.emit("global-shortcut-toggle", ());
            }
        })
        .build();

    let active_hotkey = Arc::new(Mutex::new(String::new()));

    tauri::Builder::default()
        .plugin(global_shortcut_plugin)
        .manage(AppState {
            recorder: Mutex::new(Recorder::default()),
            insert_target: Mutex::new(None),
            hotkey: Arc::clone(&active_hotkey),
            modifier_hotkey: ModifierHotkeyState::new(active_hotkey),
        })
        .setup(|app| {
            let _ = app.path().app_config_dir();
            let mut config = load_config_from_disk().unwrap_or_default();
            if let Err(err) = register_hotkey(
                app.handle(),
                app.state::<AppState>().inner(),
                &config.hotkey,
            ) {
                eprintln!("failed to register configured hotkey: {err}");
                if register_hotkey(
                    app.handle(),
                    app.state::<AppState>().inner(),
                    "Control+Option+Space",
                )
                .is_ok()
                {
                    config.hotkey = "Control+Option+Space".to_string();
                    let _ = save_config_to_disk(&config);
                }
            }
            if !insertion::has_accessibility_permission() {
                let _ = insertion::request_accessibility_permission();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            start_recording,
            stop_recording,
            cancel_recording,
            transcribe_audio,
            polish_text,
            paste_text,
            copy_text,
            update_capsule,
            open_input_monitoring_settings,
            open_accessibility_settings,
            install_to_applications_and_open_input_monitoring
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Tauri app");
}
