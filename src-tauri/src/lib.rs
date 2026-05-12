mod app_config;
mod health;
mod insertion;
mod local_asr;
mod modifier_hotkey;
mod permissions;
mod providers;
mod recorder;
mod secret_store;

use app_config::{load_config_from_disk, save_config_to_disk, AppConfig, Preset};
use insertion::InsertTarget;
use modifier_hotkey::{ModifierHotkeyState, RIGHT_OPTION_HOTKEY};
use recorder::{Recorder, RecordingResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashSet, VecDeque};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_sql::{Migration, MigrationKind};

struct AppState {
    recorder: Mutex<Recorder>,
    insert_target: Mutex<Option<InsertTarget>>,
    /// Single string flag used by `modifier_hotkey` to decide whether the right-Option
    /// monitor should fire — set to `"RightOption"` when any preset uses it.
    hotkey: Arc<Mutex<String>>,
    modifier_hotkey: ModifierHotkeyState,
    /// All currently-registered (hotkey-string, parsed Shortcut) pairs, used to
    /// resolve which preset fired in the global-shortcut handler and to unregister
    /// cleanly when presets change.
    shortcut_registry: Arc<Mutex<Vec<(String, Shortcut)>>>,
    local_asr_process: Mutex<Option<Child>>,
    composition: Mutex<Option<CompositionState>>,
    last_insert_target: Mutex<Option<InsertTarget>>,
    recent_insert_contexts: Mutex<VecDeque<RecentInsertContext>>,
}

#[derive(Clone, Debug)]
struct CompositionState {
    session_id: String,
    target: Option<InsertTarget>,
    current_text: String,
}

#[derive(Clone, Debug)]
struct RecentInsertContext {
    session_id: String,
    target: Option<InsertTarget>,
    raw_text: String,
    final_text: String,
    inserted_text: String,
    inserted_at_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RememberInsertContextPayload {
    session_id: String,
    raw_text: String,
    final_text: String,
    inserted_text: String,
    inserted_at_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadbackResult {
    session_id: String,
    target_app: String,
    inserted_text: String,
    edited_text: String,
    read_text: String,
    learned: bool,
    reason: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LearnSelectedTextResult {
    selected_text: String,
    target_app: String,
    matched_session_id: Option<String>,
    inserted_text: String,
    learned: bool,
    reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveBenchmarkSamplePayload {
    expected_text: String,
    audio_path: Option<String>,
    category: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderScore {
    provider_id: String,
    score: f64,
    p50_first_partial_ms: Option<u64>,
    p95_first_partial_ms: Option<u64>,
    p50_final_ms: Option<u64>,
    error_rate: f64,
    tech_term_recall: f64,
    sample_count: u64,
    updated_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AutoAsrSessionInfo {
    session_id: String,
    first_candidate_id: String,
    candidates: Vec<String>,
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
    sync_legacy_hotkey(&mut config);
    register_presets(&app, &state, &config.presets)?;
    save_config_to_disk(&config).map_err(|err| err.to_string())?;
    Ok(config.hotkey.clone())
}

#[tauri::command]
fn start_recording(
    app: AppHandle,
    state: tauri::State<AppState>,
    config: AppConfig,
) -> Result<(), String> {
    let realtime_tx =
        providers::start_realtime_asr(&app, &config).map_err(|err| err.to_string())?;

    state
        .recorder
        .lock()
        .map_err(|_| "录音状态锁定失败".to_string())?
        .start_with_realtime(realtime_tx)
        .map_err(|err| err.to_string())?;

    let insert_target = insertion::capture_insert_target()
        .map_err(|err| {
            eprintln!("failed to capture insert target: {err}");
            err
        })
        .ok()
        .flatten();
    if let Some(target) = insert_target.as_ref() {
        eprintln!(
            "captured insert target: {} ({})",
            target.app_name, target.pid
        );
    } else {
        eprintln!("captured insert target: none");
    }
    *state
        .insert_target
        .lock()
        .map_err(|_| "插入目标状态锁定失败".to_string())? = insert_target;
    Ok(())
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
fn cleanup_recording_file(wav_path: String) -> Result<(), String> {
    if std::env::var("TYPELESS_KEEP_RECORDINGS").ok().as_deref() == Some("1") {
        return Ok(());
    }
    let path = PathBuf::from(&wav_path);
    if path.extension().and_then(|value| value.to_str()) != Some("wav") {
        return Err("只允许清理临时 WAV 录音文件".to_string());
    }
    let canonical = path
        .canonicalize()
        .map_err(|err| format!("录音文件不存在或无法访问：{err}"))?;
    let temp_root = std::env::temp_dir()
        .canonicalize()
        .map_err(|err| format!("无法定位系统临时目录：{err}"))?;
    if !canonical.starts_with(&temp_root) {
        return Err("拒绝清理非临时目录中的录音文件".to_string());
    }
    if canonical.exists() {
        std::fs::remove_file(&canonical).map_err(|err| format!("无法清理临时录音文件：{err}"))?;
    }
    let sibling_without_ext = canonical.with_extension("");
    if sibling_without_ext.starts_with(&temp_root) && sibling_without_ext.exists() {
        let _ = std::fs::remove_file(sibling_without_ext);
    }
    Ok(())
}

#[tauri::command]
async fn polish_text(config: AppConfig, text: String, mode: String) -> Result<String, String> {
    providers::polish_text(&config, &text, &mode)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn probe_asr_endpoint(config: AppConfig) -> Result<health::ProbeResult, String> {
    Ok(health::probe_asr(&config).await)
}

#[tauri::command]
async fn probe_polish_endpoint(config: AppConfig) -> Result<health::ProbeResult, String> {
    Ok(health::probe_polish(&config).await)
}

#[tauri::command]
async fn check_secret_status() -> Result<health::SecretStatus, String> {
    tauri::async_runtime::spawn_blocking(health::secret_status)
        .await
        .map_err(|err| format!("读取 Keychain 状态失败：{err}"))
}

#[tauri::command]
async fn local_asr_status(
    _state: tauri::State<'_, AppState>,
    _config: AppConfig,
) -> Result<local_asr::LocalAsrStatus, String> {
    local_asr::status().await.map_err(|err| err.to_string())
}

#[tauri::command]
async fn install_local_asr_models(
    _state: tauri::State<'_, AppState>,
) -> Result<local_asr::LocalAsrStatus, String> {
    local_asr::install_models()
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn install_local_asr_runtime(
    _state: tauri::State<'_, AppState>,
) -> Result<local_asr::LocalAsrStatus, String> {
    local_asr::install_runtime()
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn open_local_asr_models_dir(app: AppHandle) -> Result<String, String> {
    local_asr::open_models_dir(app)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn open_local_asr_benchmark_dir(app: AppHandle) -> Result<String, String> {
    local_asr::open_benchmark_dir(app)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn list_local_asr_models(
    _state: tauri::State<'_, AppState>,
) -> Result<Vec<local_asr::LocalModelStatus>, String> {
    local_asr::list_models()
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn list_local_asr_engines(
    _state: tauri::State<'_, AppState>,
) -> Result<Vec<local_asr::LocalAsrEngineStatus>, String> {
    local_asr::list_engines()
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn download_local_asr_engine(
    app: AppHandle,
    _state: tauri::State<'_, AppState>,
    engine_id: String,
    mirror: Option<String>,
) -> Result<local_asr::LocalAsrStatus, String> {
    local_asr::download_engine(app, engine_id, mirror)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn activate_local_asr_engine(
    _state: tauri::State<'_, AppState>,
    engine_id: String,
) -> Result<local_asr::LocalAsrStatus, String> {
    local_asr::activate_engine(engine_id)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn delete_local_asr_engine(
    _state: tauri::State<'_, AppState>,
    engine_id: String,
) -> Result<local_asr::LocalAsrStatus, String> {
    local_asr::delete_engine(engine_id)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn download_local_asr_model(
    app: AppHandle,
    _state: tauri::State<'_, AppState>,
    model_id: String,
    mirror: Option<String>,
) -> Result<local_asr::LocalAsrStatus, String> {
    local_asr::download_model(app, model_id, mirror)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn cancel_local_asr_download(
    _state: tauri::State<'_, AppState>,
    model_id: String,
) -> Result<(), String> {
    tauri::async_runtime::block_on(local_asr::cancel_download(model_id))
        .map(|_| ())
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn activate_local_asr_model(
    _state: tauri::State<'_, AppState>,
    model_id: String,
) -> Result<local_asr::LocalAsrStatus, String> {
    local_asr::activate_model(model_id)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn delete_local_asr_model(
    _state: tauri::State<'_, AppState>,
    model_id: String,
) -> Result<local_asr::LocalAsrStatus, String> {
    local_asr::delete_model(model_id)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn start_local_asr_runtime(
    _state: tauri::State<'_, AppState>,
    _config: AppConfig,
) -> Result<local_asr::LocalAsrStatus, String> {
    local_asr::start_runtime()
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
async fn stop_local_asr_runtime(
    state: tauri::State<'_, AppState>,
    _config: AppConfig,
) -> Result<local_asr::LocalAsrStatus, String> {
    {
        let mut process = state
            .local_asr_process
            .lock()
            .map_err(|_| "本地 ASR runtime 状态锁定失败".to_string())?;
        if let Some(mut child) = process.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    local_asr::stop_runtime()
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn check_permissions() -> permissions::PermissionStatus {
    permissions::check_all()
}

#[tauri::command]
fn test_microphone() -> Result<f32, String> {
    permissions::test_microphone()
}

#[tauri::command]
fn paste_text(state: tauri::State<AppState>, text: String) -> Result<String, String> {
    let insert_target = state
        .insert_target
        .lock()
        .map_err(|_| "插入目标状态锁定失败".to_string())?
        .take();
    *state
        .last_insert_target
        .lock()
        .map_err(|_| "最近插入目标状态锁定失败".to_string())? = insert_target.clone();
    if let Some(target) = insert_target.as_ref() {
        eprintln!(
            "paste_text invoked: {} chars, target {} ({})",
            text.chars().count(),
            target.app_name,
            target.pid
        );
    } else {
        eprintln!(
            "paste_text invoked: {} chars, target none",
            text.chars().count()
        );
    }
    insertion::paste_text(&text, insert_target.as_ref()).map_err(|err| err.to_string())
}

#[tauri::command]
fn begin_composition(state: tauri::State<AppState>) -> Result<String, String> {
    let target = state
        .insert_target
        .lock()
        .map_err(|_| "插入目标状态锁定失败".to_string())?
        .clone();
    let session_id = uuid::Uuid::new_v4().to_string();
    *state
        .composition
        .lock()
        .map_err(|_| "组合输入状态锁定失败".to_string())? = Some(CompositionState {
        session_id: session_id.clone(),
        target,
        current_text: String::new(),
    });
    Ok(session_id)
}

#[tauri::command]
fn apply_composition_patch(
    state: tauri::State<AppState>,
    session_id: String,
    text: String,
    kind: String,
) -> Result<String, String> {
    let (target, previous_chars) = {
        let mut composition = state
            .composition
            .lock()
            .map_err(|_| "组合输入状态锁定失败".to_string())?;
        let active = composition
            .as_mut()
            .ok_or_else(|| "当前没有组合输入会话".to_string())?;
        if active.session_id != session_id {
            return Err("组合输入会话已过期".to_string());
        }
        let previous_chars = active.current_text.chars().count();
        active.current_text = text.clone();
        (active.target.clone(), previous_chars)
    };
    insertion::replace_composition_text(&text, target.as_ref(), previous_chars)
        .map_err(|err| format!("{} patch 失败：{err}", kind))
}

#[tauri::command]
fn finish_composition(state: tauri::State<AppState>, session_id: String) -> Result<(), String> {
    let mut composition = state
        .composition
        .lock()
        .map_err(|_| "组合输入状态锁定失败".to_string())?;
    if composition
        .as_ref()
        .map(|active| active.session_id.as_str())
        == Some(session_id.as_str())
    {
        let target = composition
            .as_ref()
            .and_then(|active| active.target.clone());
        *state
            .last_insert_target
            .lock()
            .map_err(|_| "最近插入目标状态锁定失败".to_string())? = target;
        *composition = None;
    }
    Ok(())
}

#[tauri::command]
fn cancel_composition(state: tauri::State<AppState>, session_id: String) -> Result<(), String> {
    let active = {
        let mut composition = state
            .composition
            .lock()
            .map_err(|_| "组合输入状态锁定失败".to_string())?;
        match composition.as_ref() {
            Some(active) if active.session_id == session_id => composition.take(),
            _ => None,
        }
    };
    if let Some(active) = active {
        if !active.current_text.is_empty() {
            insertion::replace_composition_text(
                "",
                active.target.as_ref(),
                active.current_text.chars().count(),
            )
            .map_err(|err| format!("撤销实时输入失败：{err}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn run_asr_benchmark() -> Result<local_asr::BenchmarkResult, String> {
    let config = load_config_from_disk().unwrap_or_default();
    local_asr::run_benchmark(config.local_asr_engine_id)
        .await
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn start_auto_asr_session(config: AppConfig) -> Result<AutoAsrSessionInfo, String> {
    let candidates = if config.asr_provider_candidates.is_empty() {
        vec![
            "alibaba_paraformer_realtime".to_string(),
            "volcengine".to_string(),
            "local_hybrid".to_string(),
            "whisper_compatible".to_string(),
        ]
    } else {
        config
            .asr_provider_candidates
            .iter()
            .map(|candidate| candidate.trim())
            .filter(|candidate| !candidate.is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>()
    };
    let first_candidate_id = candidates
        .first()
        .cloned()
        .unwrap_or_else(|| "alibaba_paraformer_realtime".to_string());
    Ok(AutoAsrSessionInfo {
        session_id: uuid::Uuid::new_v4().to_string(),
        first_candidate_id,
        candidates,
    })
}

#[tauri::command]
fn list_provider_scores() -> Result<Vec<ProviderScore>, String> {
    let now = current_timestamp_ms();
    Ok(vec![
        ProviderScore {
            provider_id: "alibaba_paraformer_realtime".to_string(),
            score: 0.0,
            p50_first_partial_ms: None,
            p95_first_partial_ms: None,
            p50_final_ms: None,
            error_rate: 0.0,
            tech_term_recall: 0.0,
            sample_count: 0,
            updated_at: now,
        },
        ProviderScore {
            provider_id: "volcengine".to_string(),
            score: 0.0,
            p50_first_partial_ms: None,
            p95_first_partial_ms: None,
            p50_final_ms: None,
            error_rate: 0.0,
            tech_term_recall: 0.0,
            sample_count: 0,
            updated_at: now,
        },
        ProviderScore {
            provider_id: "local_hybrid".to_string(),
            score: 0.0,
            p50_first_partial_ms: None,
            p95_first_partial_ms: None,
            p50_final_ms: None,
            error_rate: 0.0,
            tech_term_recall: 0.0,
            sample_count: 0,
            updated_at: now,
        },
    ])
}

#[tauri::command]
fn run_provider_benchmark() -> Result<Vec<ProviderScore>, String> {
    list_provider_scores()
}

#[tauri::command]
fn save_benchmark_sample(
    app: AppHandle,
    payload: SaveBenchmarkSamplePayload,
) -> Result<String, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("无法定位 App data 目录：{err}"))?
        .join("asr-benchmark-samples");
    std::fs::create_dir_all(&dir).map_err(|err| format!("无法创建评测样本目录：{err}"))?;
    let category = payload
        .category
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("manual");
    let meta = serde_json::json!({
        "id": id,
        "expectedText": payload.expected_text,
        "audioPath": payload.audio_path,
        "category": category,
        "createdAt": current_timestamp_ms()
    });
    let meta_path = dir.join(format!("{id}.json"));
    std::fs::write(
        &meta_path,
        serde_json::to_vec_pretty(&meta).map_err(|err| format!("无法编码评测样本：{err}"))?,
    )
    .map_err(|err| format!("无法写入评测样本：{err}"))?;
    Ok(id)
}

#[tauri::command]
fn remember_recent_insert_context(
    state: tauri::State<AppState>,
    payload: RememberInsertContextPayload,
) -> Result<(), String> {
    let target = state
        .last_insert_target
        .lock()
        .map_err(|_| "最近插入目标状态锁定失败".to_string())?
        .clone()
        .or_else(|| {
            state
                .insert_target
                .lock()
                .ok()
                .and_then(|target| target.clone())
        });
    let mut contexts = state
        .recent_insert_contexts
        .lock()
        .map_err(|_| "最近插入上下文状态锁定失败".to_string())?;
    contexts.push_front(RecentInsertContext {
        session_id: payload.session_id,
        target,
        raw_text: payload.raw_text,
        final_text: payload.final_text,
        inserted_text: payload.inserted_text,
        inserted_at_ms: payload.inserted_at_ms,
    });
    while contexts.len() > 12 {
        contexts.pop_back();
    }
    Ok(())
}

#[tauri::command]
fn read_recent_insert_context(
    state: tauri::State<AppState>,
    session_id: String,
) -> Result<ReadbackResult, String> {
    let context = state
        .recent_insert_contexts
        .lock()
        .map_err(|_| "最近插入上下文状态锁定失败".to_string())?
        .iter()
        .find(|context| context.session_id == session_id)
        .cloned()
        .ok_or_else(|| "没有找到最近插入上下文".to_string())?;
    if current_timestamp_ms().saturating_sub(context.inserted_at_ms) > 10 * 60 * 1000 {
        return Err("最近插入上下文已过期".to_string());
    }
    let target_app = context
        .target
        .as_ref()
        .map(|target| target.app_name.clone())
        .unwrap_or_default();
    let read_text =
        insertion::read_focused_text_window(context.target.as_ref(), &context.inserted_text)
            .map_err(|err| err.to_string())?;
    let edited_text = infer_edited_text(&context.inserted_text, &read_text);
    Ok(ReadbackResult {
        session_id,
        target_app,
        inserted_text: context.inserted_text,
        edited_text,
        read_text,
        learned: false,
        reason: "read".to_string(),
    })
}

#[tauri::command]
fn learn_selected_text(state: tauri::State<AppState>) -> Result<LearnSelectedTextResult, String> {
    let (selected_text, target) = insertion::read_selected_text().map_err(|err| err.to_string())?;
    let selected_text = selected_text.trim().to_string();
    let context = state
        .recent_insert_contexts
        .lock()
        .map_err(|_| "最近插入上下文状态锁定失败".to_string())?
        .iter()
        .find(|context| {
            !selected_text.is_empty()
                && (context.inserted_text.contains(&selected_text)
                    || context.raw_text.contains(&selected_text)
                    || context.final_text.contains(&selected_text)
                    || similar_short_text(&context.inserted_text, &selected_text))
        })
        .cloned();
    Ok(LearnSelectedTextResult {
        selected_text,
        target_app: target
            .as_ref()
            .map(|target| target.app_name.clone())
            .unwrap_or_default(),
        matched_session_id: context.as_ref().map(|context| context.session_id.clone()),
        inserted_text: context
            .as_ref()
            .map(|context| context.inserted_text.clone())
            .unwrap_or_default(),
        learned: false,
        reason: "selected".to_string(),
    })
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
    let target_app = PathBuf::from("/Applications/Typelesss.app");
    if same_path(&source_app, &target_app) {
        let _ = open_input_monitoring_settings();
        let _ = open_accessibility_settings();
        return Ok(
            "当前 App 已在 /Applications。已打开输入监控和辅助功能授权页，请勾选 Typelesss 后重启 App。"
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
    Ok("已安装到 /Applications。请在输入监控和辅助功能中添加或允许 Typelesss，然后从应用程序文件夹重启 App。".to_string())
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

/// Mirror the active preset's hotkey into the legacy `config.hotkey` field
/// (keeps backward-compat for any code that still reads it).
fn sync_legacy_hotkey(config: &mut AppConfig) {
    if let Some(active) = config
        .presets
        .iter()
        .find(|p| p.id == config.active_preset_id)
    {
        config.hotkey = active.hotkey.clone();
        config.output_mode = active.output_mode.clone();
    }
}

/// Re-register all preset hotkeys.  Unregisters previous shortcuts first,
/// then attempts each new one; failed registrations are logged but don't
/// abort the rest.  Right-Option is handled via the modifier monitor.
fn register_presets(
    app: &AppHandle,
    state: &AppState,
    presets: &[Preset],
) -> Result<Vec<String>, String> {
    let normalized: Vec<(String, String)> = presets
        .iter()
        .map(|p| {
            let hk = normalize_hotkey(&p.hotkey)?;
            Ok::<_, String>((p.id.clone(), hk))
        })
        .collect::<Result<Vec<_>, _>>()?;

    let mut seen: HashSet<String> = HashSet::new();
    for (_, hk) in &normalized {
        if !seen.insert(hk.clone()) {
            return Err(format!("快捷键 {hk} 被多个预设占用，请改一个。"));
        }
    }

    {
        let mut registry = state
            .shortcut_registry
            .lock()
            .map_err(|_| "快捷键状态锁定失败".to_string())?;
        for (hk, _) in registry.iter() {
            if hk != RIGHT_OPTION_HOTKEY {
                let _ = app.global_shortcut().unregister(hk.as_str());
            }
        }
        registry.clear();
    }

    let right_option_used = normalized.iter().any(|(_, hk)| hk == RIGHT_OPTION_HOTKEY);
    {
        let mut current = state
            .hotkey
            .lock()
            .map_err(|_| "快捷键状态锁定失败".to_string())?;
        *current = if right_option_used {
            RIGHT_OPTION_HOTKEY.to_string()
        } else {
            String::new()
        };
    }
    if right_option_used {
        if let Err(err) = state
            .modifier_hotkey
            .ensure_right_option_monitor(app.clone())
        {
            eprintln!("Right Option saved but not active yet: {err}");
            let _ = open_input_monitoring_settings();
        }
    }

    let mut registered_strings: Vec<String> = Vec::with_capacity(normalized.len());
    let mut registry_entries: Vec<(String, Shortcut)> = Vec::with_capacity(normalized.len());
    for (_id, hk) in &normalized {
        if hk == RIGHT_OPTION_HOTKEY {
            registered_strings.push(hk.clone());
            continue;
        }
        let parsed = match Shortcut::from_str(hk.as_str()) {
            Ok(sc) => sc,
            Err(err) => {
                eprintln!("Invalid hotkey {hk}: {err}");
                continue;
            }
        };
        match app.global_shortcut().register(hk.as_str()) {
            Ok(()) => {
                registered_strings.push(hk.clone());
                registry_entries.push((hk.clone(), parsed));
            }
            Err(err) => {
                eprintln!("Failed to register {hk}: {err}");
            }
        }
    }
    {
        let mut registry = state
            .shortcut_registry
            .lock()
            .map_err(|_| "快捷键状态锁定失败".to_string())?;
        *registry = registry_entries;
    }

    Ok(registered_strings)
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

fn infer_edited_text(inserted_text: &str, read_text: &str) -> String {
    let inserted = inserted_text.trim();
    let read = read_text.trim();
    if read.is_empty() || read.contains(inserted) {
        return inserted.to_string();
    }
    let inserted_len = inserted.chars().count();
    let read_len = read.chars().count();
    if inserted_len > 0
        && read_len <= inserted_len.saturating_mul(2).saturating_add(8)
        && similar_short_text(inserted, read)
    {
        return read.to_string();
    }
    inserted.to_string()
}

fn similar_short_text(left: &str, right: &str) -> bool {
    let left = compact_text(left);
    let right = compact_text(right);
    if left.is_empty() || right.is_empty() || left.len() > 96 || right.len() > 96 {
        return false;
    }
    let distance = levenshtein_chars(&left, &right);
    let max_len = left.chars().count().max(right.chars().count()).max(1);
    distance * 100 / max_len <= 45
}

fn compact_text(input: &str) -> String {
    input
        .chars()
        .filter(|ch| !ch.is_whitespace() && !matches!(ch, '。' | '.' | ',' | '，'))
        .flat_map(char::to_lowercase)
        .collect()
}

fn levenshtein_chars(left: &str, right: &str) -> usize {
    let left = left.chars().collect::<Vec<_>>();
    let right = right.chars().collect::<Vec<_>>();
    let mut previous = (0..=right.len()).collect::<Vec<_>>();
    let mut current = vec![0; right.len() + 1];
    for (i, left_item) in left.iter().enumerate() {
        current[0] = i + 1;
        for (j, right_item) in right.iter().enumerate() {
            let cost = usize::from(left_item != right_item);
            current[j + 1] = (previous[j + 1] + 1)
                .min(current[j] + 1)
                .min(previous[j] + cost);
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[right.len()]
}

fn current_timestamp_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod correction_memory_tests {
    use super::*;

    #[test]
    fn infers_short_edited_text_from_readback() {
        assert_eq!(infer_edited_text("codeex。", "codex。"), "codex。");
        assert_eq!(
            infer_edited_text("codeex。", "我要使用 codeex。"),
            "codeex。"
        );
    }

    #[test]
    fn matches_similar_short_text() {
        assert!(similar_short_text("codeex。", "codex"));
        assert!(!similar_short_text("一段很长的完全不同文本", "codex"));
    }
}

pub fn run() {
    let active_hotkey: Arc<Mutex<String>> = Arc::new(Mutex::new(String::new()));
    let shortcut_registry: Arc<Mutex<Vec<(String, Shortcut)>>> = Arc::new(Mutex::new(Vec::new()));

    let handler_registry = Arc::clone(&shortcut_registry);
    let global_shortcut_plugin = tauri_plugin_global_shortcut::Builder::new()
        .with_handler(move |app, shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                let matched = handler_registry
                    .lock()
                    .ok()
                    .and_then(|reg| {
                        reg.iter()
                            .find(|(_, sc)| sc == shortcut)
                            .map(|(s, _)| s.clone())
                    })
                    .unwrap_or_else(|| shortcut.to_string());
                let payload = serde_json::json!({ "shortcut": matched });
                let _ = app.emit("global-shortcut-toggle", payload);
            }
        })
        .build();

    let history_migrations = vec![
        Migration {
            version: 1,
            description: "create dictation_sessions and correction_pairs tables",
            sql: r#"
            CREATE TABLE IF NOT EXISTS dictation_sessions (
                id TEXT PRIMARY KEY,
                started_at INTEGER NOT NULL,
                duration_ms INTEGER NOT NULL,
                raw_text TEXT NOT NULL DEFAULT '',
                normalized_text TEXT NOT NULL DEFAULT '',
                final_text TEXT NOT NULL DEFAULT '',
                output_mode TEXT NOT NULL DEFAULT '',
                asr_provider TEXT NOT NULL DEFAULT '',
                polish_provider TEXT NOT NULL DEFAULT '',
                target_app TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_started_at
                ON dictation_sessions (started_at DESC);
            CREATE TABLE IF NOT EXISTS correction_pairs (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                before_text TEXT NOT NULL,
                after_text TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'auto',
                created_at INTEGER NOT NULL,
                FOREIGN KEY (session_id) REFERENCES dictation_sessions(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_corrections_session_id
                ON correction_pairs (session_id);
        "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create asr telemetry and personal memory tables",
            sql: r#"
            CREATE TABLE IF NOT EXISTS asr_telemetry (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                provider_id TEXT NOT NULL DEFAULT '',
                target_app TEXT NOT NULL DEFAULT '',
                hotkey_down_at INTEGER,
                first_audio_sent_at INTEGER,
                first_partial_at INTEGER,
                stable_insert_at INTEGER,
                final_received_at INTEGER,
                insert_done_at INTEGER,
                asr_latency_ms INTEGER,
                final_latency_ms INTEGER,
                insert_latency_ms INTEGER,
                error TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                FOREIGN KEY (session_id) REFERENCES dictation_sessions(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_asr_telemetry_provider_created
                ON asr_telemetry (provider_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS personal_terms (
                id TEXT PRIMARY KEY,
                canonical TEXT NOT NULL UNIQUE,
                aliases_json TEXT NOT NULL DEFAULT '[]',
                category TEXT NOT NULL DEFAULT 'personal',
                source TEXT NOT NULL DEFAULT 'session',
                weight REAL NOT NULL DEFAULT 1,
                usage_count INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL,
                last_seen_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_personal_terms_last_seen
                ON personal_terms (last_seen_at DESC);

            CREATE TABLE IF NOT EXISTS app_context_profiles (
                app_id TEXT PRIMARY KEY,
                app_name TEXT NOT NULL DEFAULT '',
                preferred_output_mode TEXT NOT NULL DEFAULT '',
                term_boost_json TEXT NOT NULL DEFAULT '[]',
                last_used_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
        "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "create local asr benchmark table",
            sql: r#"
            CREATE TABLE IF NOT EXISTS asr_benchmark_runs (
                id TEXT PRIMARY KEY,
                engine_id TEXT NOT NULL,
                mode TEXT NOT NULL DEFAULT '',
                sample_count INTEGER NOT NULL DEFAULT 0,
                p50_first_partial_ms INTEGER,
                p95_first_partial_ms INTEGER,
                p50_final_ms INTEGER,
                p95_final_ms INTEGER,
                cer REAL,
                wer REAL,
                tech_term_recall REAL,
                target_app TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_asr_benchmark_engine_created
                ON asr_benchmark_runs (engine_id, created_at DESC);
        "#,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "create optimized asr provider benchmark tables",
            sql: r#"
            CREATE TABLE IF NOT EXISTS asr_benchmark_samples (
                id TEXT PRIMARY KEY,
                expected_text TEXT NOT NULL DEFAULT '',
                audio_path TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_asr_benchmark_samples_category_created
                ON asr_benchmark_samples (category, created_at DESC);

            CREATE TABLE IF NOT EXISTS asr_provider_scores (
                provider_id TEXT PRIMARY KEY,
                score REAL NOT NULL DEFAULT 0,
                p50_first_partial_ms INTEGER,
                p95_first_partial_ms INTEGER,
                p50_final_ms INTEGER,
                error_rate REAL NOT NULL DEFAULT 0,
                tech_term_recall REAL NOT NULL DEFAULT 0,
                sample_count INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS asr_session_candidates (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                provider_id TEXT NOT NULL,
                candidate_order INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT '',
                latency_ms INTEGER,
                error TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_asr_session_candidates_session
                ON asr_session_candidates (session_id, candidate_order);
        "#,
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(global_shortcut_plugin)
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:typelesss-history.db", history_migrations)
                .build(),
        )
        .manage(AppState {
            recorder: Mutex::new(Recorder::default()),
            insert_target: Mutex::new(None),
            hotkey: Arc::clone(&active_hotkey),
            modifier_hotkey: ModifierHotkeyState::new(active_hotkey),
            shortcut_registry,
            local_asr_process: Mutex::new(None),
            composition: Mutex::new(None),
            last_insert_target: Mutex::new(None),
            recent_insert_contexts: Mutex::new(VecDeque::new()),
        })
        .setup(|app| {
            let _ = app.path().app_config_dir();
            let mut config = load_config_from_disk().unwrap_or_default();
            sync_legacy_hotkey(&mut config);
            if let Err(err) = register_presets(
                app.handle(),
                app.state::<AppState>().inner(),
                &config.presets,
            ) {
                eprintln!("failed to register configured presets: {err}");
            }
            if !insertion::has_accessibility_permission() {
                let _ = insertion::request_accessibility_permission();
            }
            std::thread::spawn(|| {
                if let Err(err) = recorder::warm_up_input_device() {
                    eprintln!("microphone warm-up skipped: {err}");
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            start_recording,
            stop_recording,
            cleanup_recording_file,
            cancel_recording,
            transcribe_audio,
            polish_text,
            paste_text,
            copy_text,
            update_capsule,
            open_input_monitoring_settings,
            open_accessibility_settings,
            install_to_applications_and_open_input_monitoring,
            probe_asr_endpoint,
            probe_polish_endpoint,
            check_secret_status,
            local_asr_status,
            install_local_asr_models,
            install_local_asr_runtime,
            open_local_asr_models_dir,
            open_local_asr_benchmark_dir,
            list_local_asr_models,
            list_local_asr_engines,
            download_local_asr_model,
            download_local_asr_engine,
            cancel_local_asr_download,
            activate_local_asr_model,
            activate_local_asr_engine,
            delete_local_asr_model,
            delete_local_asr_engine,
            start_local_asr_runtime,
            stop_local_asr_runtime,
            begin_composition,
            apply_composition_patch,
            finish_composition,
            cancel_composition,
            start_auto_asr_session,
            run_provider_benchmark,
            save_benchmark_sample,
            list_provider_scores,
            run_asr_benchmark,
            remember_recent_insert_context,
            read_recent_insert_context,
            learn_selected_text,
            check_permissions,
            test_microphone
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Tauri app");
}
