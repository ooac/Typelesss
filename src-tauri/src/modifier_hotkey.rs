use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::Emitter;

pub const RIGHT_OPTION_HOTKEY: &str = "RightOption";

pub struct ModifierHotkeyState {
    active_hotkey: Arc<Mutex<String>>,
    started: AtomicBool,
}

impl ModifierHotkeyState {
    pub fn new(active_hotkey: Arc<Mutex<String>>) -> Self {
        Self {
            active_hotkey,
            started: AtomicBool::new(false),
        }
    }

    #[cfg(target_os = "macos")]
    pub fn ensure_right_option_monitor(&self, app: tauri::AppHandle) -> Result<(), String> {
        use core_graphics::event::CGEventTapLocation;
        use std::sync::mpsc;
        use std::time::Duration;

        ensure_input_monitoring_permission()?;

        if self.started.load(Ordering::SeqCst) {
            return Ok(());
        }

        if self.started.swap(true, Ordering::SeqCst) {
            return Ok(());
        }

        let active_hotkey = Arc::clone(&self.active_hotkey);
        let (sender, receiver) = mpsc::channel::<Result<(), String>>();

        std::thread::spawn(move || {
            let result = run_right_option_tap(
                CGEventTapLocation::HID,
                Arc::clone(&active_hotkey),
                app.clone(),
                sender.clone(),
            )
            .or_else(|_| {
                run_right_option_tap(
                    CGEventTapLocation::Session,
                    active_hotkey,
                    app,
                    sender.clone(),
                )
            });

            if result.is_err() {
                let _ = sender.send(Err(
                    "右 Option 监听启动失败。请在系统设置中给 OpenLess Realtime Input 开启输入监控和辅助功能权限。".to_string(),
                ));
            }
        });

        match receiver.recv_timeout(Duration::from_secs(2)) {
            Ok(Ok(())) => Ok(()),
            Ok(Err(err)) => {
                self.started.store(false, Ordering::SeqCst);
                Err(err)
            }
            Err(_) => {
                self.started.store(false, Ordering::SeqCst);
                Err("右 Option 监听启动超时，请重启 App 后重试。".to_string())
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    pub fn ensure_right_option_monitor(&self, _app: tauri::AppHandle) -> Result<(), String> {
        Err("RightOption 仅支持 macOS。".to_string())
    }
}

#[cfg(target_os = "macos")]
fn ensure_input_monitoring_permission() -> Result<(), String> {
    if input_monitoring_permission_granted() {
        return Ok(());
    }

    let _ = request_input_monitoring_permission();
    if input_monitoring_permission_granted() {
        Ok(())
    } else {
        Err(
            "Right Option 需要输入监控权限。请在系统设置 > 隐私与安全性 > 输入监控 中允许 OpenLess Realtime Input，然后重启 App。"
                .to_string(),
        )
    }
}

#[cfg(target_os = "macos")]
pub fn input_monitoring_permission_granted() -> bool {
    unsafe { CGPreflightListenEventAccess() }
}

#[cfg(not(target_os = "macos"))]
pub fn input_monitoring_permission_granted() -> bool {
    false
}

#[cfg(target_os = "macos")]
fn request_input_monitoring_permission() -> bool {
    unsafe { CGRequestListenEventAccess() }
}

#[cfg(target_os = "macos")]
fn run_right_option_tap(
    location: core_graphics::event::CGEventTapLocation,
    active_hotkey: Arc<Mutex<String>>,
    app: tauri::AppHandle,
    started_sender: std::sync::mpsc::Sender<Result<(), String>>,
) -> Result<(), ()> {
    use core_foundation::runloop::CFRunLoop;
    use core_graphics::event::{
        CGEventFlags, CGEventTap, CGEventTapOptions, CGEventTapPlacement, CGEventType,
        CallbackResult, EventField, KeyCode,
    };

    let pressed = Arc::new(AtomicBool::new(false));
    let callback_pressed = Arc::clone(&pressed);

    CGEventTap::with_enabled(
        location,
        CGEventTapPlacement::HeadInsertEventTap,
        CGEventTapOptions::ListenOnly,
        vec![CGEventType::FlagsChanged],
        move |_proxy, event_type, event| {
            if !matches!(event_type, CGEventType::FlagsChanged) {
                return CallbackResult::Keep;
            }

            let keycode = event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE) as u16;
            if keycode != KeyCode::RIGHT_OPTION {
                return CallbackResult::Keep;
            }

            let is_active = active_hotkey
                .lock()
                .map(|hotkey| hotkey.as_str() == RIGHT_OPTION_HOTKEY)
                .unwrap_or(false);
            if !is_active {
                callback_pressed.store(false, Ordering::SeqCst);
                return CallbackResult::Keep;
            }

            let is_down = event
                .get_flags()
                .contains(CGEventFlags::CGEventFlagAlternate);
            if is_down && !callback_pressed.swap(true, Ordering::SeqCst) {
                let _ = app.emit("global-shortcut-pressed", ());
            } else if !is_down && callback_pressed.swap(false, Ordering::SeqCst) {
                let _ = app.emit("global-shortcut-released", ());
            }

            CallbackResult::Keep
        },
        || {
            let _ = started_sender.send(Ok(()));
            CFRunLoop::run_current();
        },
    )
    .map(|_| ())
}

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn CGPreflightListenEventAccess() -> bool;
    fn CGRequestListenEventAccess() -> bool;
}
