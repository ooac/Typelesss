use crate::app_config::{load_config_from_disk, save_config_to_disk, AppConfig};
use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter};
use tokio::task;

const READY_SENTINEL: &str = ".openless-asr-ready";
const DOWNLOAD_CHUNK_SIZE: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalModelId {
    Qwen06b,
    Qwen17b,
}

impl LocalModelId {
    pub fn as_str(self) -> &'static str {
        match self {
            LocalModelId::Qwen06b => "qwen3-asr-0.6b",
            LocalModelId::Qwen17b => "qwen3-asr-1.7b",
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            LocalModelId::Qwen06b => "Qwen3-ASR-0.6B",
            LocalModelId::Qwen17b => "Qwen3-ASR-1.7B",
        }
    }

    pub fn hf_repo(self) -> &'static str {
        match self {
            LocalModelId::Qwen06b => "Qwen/Qwen3-ASR-0.6B",
            LocalModelId::Qwen17b => "Qwen/Qwen3-ASR-1.7B",
        }
    }

    pub fn all() -> &'static [LocalModelId] {
        &[LocalModelId::Qwen06b, LocalModelId::Qwen17b]
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "qwen3-asr-0.6b" | "Qwen3-ASR-0.6B" | "Qwen/Qwen3-ASR-0.6B" => Some(Self::Qwen06b),
            "qwen3-asr-1.7b" | "Qwen3-ASR-1.7B" | "Qwen/Qwen3-ASR-1.7B" => Some(Self::Qwen17b),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DownloadMirror {
    Huggingface,
    HfMirror,
}

impl Default for DownloadMirror {
    fn default() -> Self {
        Self::Huggingface
    }
}

impl DownloadMirror {
    pub fn base_url(self) -> &'static str {
        match self {
            DownloadMirror::Huggingface => "https://huggingface.co",
            DownloadMirror::HfMirror => "https://hf-mirror.com",
        }
    }

    pub fn from_str(value: &str) -> Self {
        match value {
            "hf-mirror" => Self::HfMirror,
            _ => Self::Huggingface,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelStatus {
    pub id: String,
    pub display_name: String,
    pub hf_repo: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub is_downloaded: bool,
    pub is_active: bool,
    pub download_phase: String,
    pub download_progress: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAsrStatus {
    pub installed: bool,
    pub runtime_reachable: bool,
    pub model_root: String,
    pub streaming_model_installed: bool,
    pub final_model_installed: bool,
    pub endpoint: String,
    pub runtime_binary: String,
    pub runtime_binary_found: bool,
    pub message: String,
    pub models: Vec<LocalModelStatus>,
    pub active_model_id: String,
    pub download_progress: f64,
    pub download_phase: String,
    pub is_active: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAsrDownloadProgress {
    pub model_id: String,
    pub file: String,
    pub file_index: usize,
    pub file_count: usize,
    pub bytes_downloaded: u64,
    pub bytes_total: u64,
    pub phase: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct HfTreeEntry {
    #[serde(rename = "type")]
    entry_type: String,
    path: String,
    #[serde(default)]
    size: Option<u64>,
}

#[derive(Debug, Clone)]
struct RemoteFile {
    path: String,
    size: u64,
}

#[derive(Default)]
pub struct LocalAsrDownloadState {
    phases: Mutex<HashMap<String, String>>,
    cancel: Mutex<HashSet<String>>,
}

impl LocalAsrDownloadState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn phase(&self, model_id: &str) -> String {
        self.phases
            .lock()
            .ok()
            .and_then(|phases| phases.get(model_id).cloned())
            .unwrap_or_else(|| "idle".to_string())
    }

    pub fn set_phase(&self, model_id: &str, phase: &str) {
        if let Ok(mut phases) = self.phases.lock() {
            phases.insert(model_id.to_string(), phase.to_string());
        }
    }

    pub fn request_cancel(&self, model_id: &str) {
        if let Ok(mut cancel) = self.cancel.lock() {
            cancel.insert(model_id.to_string());
        }
    }

    fn clear_cancel(&self, model_id: &str) {
        if let Ok(mut cancel) = self.cancel.lock() {
            cancel.remove(model_id);
        }
    }

    fn is_cancelled(&self, model_id: &str) -> bool {
        self.cancel
            .lock()
            .map(|cancel| cancel.contains(model_id))
            .unwrap_or(false)
    }
}

pub async fn status(
    config: Option<&AppConfig>,
    download_state: Option<&LocalAsrDownloadState>,
) -> LocalAsrStatus {
    let active_model_id = config
        .and_then(|config| {
            if config.asr_provider == "local_hybrid" {
                Some(config.asr_model.clone())
            } else {
                None
            }
        })
        .unwrap_or_default();
    let models = list_models_with_state(&active_model_id, download_state).await;
    let active_model = models.iter().find(|model| model.is_active);
    let installed = active_model
        .map(|model| model.is_downloaded)
        .unwrap_or(false);
    let download_phase = active_model
        .map(|model| model.download_phase.clone())
        .or_else(|| models.first().map(|model| model.download_phase.clone()))
        .unwrap_or_else(|| "idle".to_string());
    let download_progress = active_model
        .map(|model| model.download_progress)
        .or_else(|| models.first().map(|model| model.download_progress))
        .unwrap_or(0.0);
    let runtime_binary = qwen_binary_path()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    let runtime_binary_found = !runtime_binary.is_empty();
    let message = if installed && runtime_binary_found {
        format!("{} 已下载并启用", active_model_id)
    } else if installed {
        format!(
            "{} 已下载并启用，但 qwen_asr 识别引擎未安装完成",
            active_model_id
        )
    } else if active_model_id.is_empty() {
        "本地模型未启用".to_string()
    } else {
        format!("{} 未下载", active_model_id)
    };

    LocalAsrStatus {
        installed,
        runtime_reachable: installed && runtime_binary_found,
        model_root: models_dir().to_string_lossy().to_string(),
        streaming_model_installed: installed,
        final_model_installed: installed,
        endpoint: String::new(),
        runtime_binary,
        runtime_binary_found,
        message,
        models,
        active_model_id,
        download_progress,
        download_phase,
        is_active: installed,
    }
}

pub async fn list_models(
    config: Option<&AppConfig>,
    download_state: Option<&LocalAsrDownloadState>,
) -> Vec<LocalModelStatus> {
    let active_model_id = config
        .and_then(|config| {
            if config.asr_provider == "local_hybrid" {
                Some(config.asr_model.clone())
            } else {
                None
            }
        })
        .unwrap_or_default();
    list_models_with_state(&active_model_id, download_state).await
}

pub async fn download_model(
    app: AppHandle,
    model_id: &str,
    mirror: DownloadMirror,
    download_state: Arc<LocalAsrDownloadState>,
) -> Result<LocalAsrStatus> {
    let id = parse_model_id(model_id)?;
    let key = id.as_str().to_string();
    download_state.clear_cancel(&key);
    download_state.set_phase(&key, "started");
    let state = Arc::clone(&download_state);
    task::spawn_blocking(move || download_model_blocking(app, id, mirror, state))
        .await
        .map_err(|err| anyhow!("本地模型下载任务失败：{err}"))??;
    let config = load_config_from_disk().ok();
    Ok(status(config.as_ref(), Some(&download_state)).await)
}

pub async fn activate_model(
    model_id: &str,
    download_state: Option<&LocalAsrDownloadState>,
) -> Result<LocalAsrStatus> {
    let id = parse_model_id(model_id)?;
    if !is_model_downloaded(id) {
        return Err(anyhow!("本地模型尚未下载：{}", id.display_name()));
    }
    let mut config = load_config_from_disk().unwrap_or_default();
    config.asr_provider = "local_hybrid".to_string();
    config.asr_model = id.as_str().to_string();
    config.asr_endpoint.clear();
    save_config_to_disk(&config)?;
    Ok(status(Some(&config), download_state).await)
}

pub async fn delete_model(
    model_id: &str,
    download_state: Option<&LocalAsrDownloadState>,
) -> Result<LocalAsrStatus> {
    let id = parse_model_id(model_id)?;
    let dir = model_dir(id);
    if dir.exists() {
        fs::remove_dir_all(&dir).with_context(|| format!("无法删除本地模型：{}", dir.display()))?;
    }
    let config = load_config_from_disk().ok();
    Ok(status(config.as_ref(), download_state).await)
}

pub fn cancel_download(model_id: &str, download_state: &LocalAsrDownloadState) -> Result<()> {
    let id = parse_model_id(model_id)?;
    download_state.request_cancel(id.as_str());
    download_state.set_phase(id.as_str(), "cancelled");
    Ok(())
}

pub async fn install_models(
    download_state: Option<&LocalAsrDownloadState>,
) -> Result<LocalAsrStatus> {
    let config = load_config_from_disk().ok();
    Ok(status(config.as_ref(), download_state).await)
}

pub async fn install_runtime(
    download_state: Option<&LocalAsrDownloadState>,
) -> Result<LocalAsrStatus> {
    let config = load_config_from_disk().ok();
    Ok(status(config.as_ref(), download_state).await)
}

pub fn open_models_dir() -> Result<String> {
    let model_root = models_dir();
    fs::create_dir_all(&model_root)
        .with_context(|| format!("无法创建本地模型目录：{}", model_root.display()))?;
    let status = Command::new("open")
        .arg(&model_root)
        .status()
        .with_context(|| format!("无法打开本地模型目录：{}", model_root.display()))?;
    if !status.success() {
        return Err(anyhow!("打开本地模型目录失败：{}", model_root.display()));
    }
    Ok(model_root.to_string_lossy().to_string())
}

pub async fn transcribe_wav(config: &AppConfig, wav_path: &str) -> Result<String> {
    let id = LocalModelId::from_str(config.asr_model.trim()).unwrap_or(LocalModelId::Qwen06b);
    if !is_model_downloaded(id) {
        return Err(anyhow!(
            "本地模型未下载：请先点击下载并启用 {}",
            id.display_name()
        ));
    }
    let binary = qwen_binary_path().ok_or_else(|| {
        anyhow!(
            "未找到 qwen_asr 本地识别引擎。请重新点击本地模型的“下载并启用”，自动安装 runtime 后再试。"
        )
    })?;
    let output = task::spawn_blocking({
        let binary = binary.clone();
        let model_dir = model_dir(id);
        let wav_path = wav_path.to_string();
        move || {
            Command::new(binary)
                .arg("-d")
                .arg(model_dir)
                .arg("-i")
                .arg(wav_path)
                .arg("--prompt")
                .arg("Preserve spelling: Claude Code, OpenAI Codex, Tauri, src-tauri, TranscriptEvent, ShadowBuffer, TypeScript, Rust, React, Vite")
                .arg("--silent")
                .output()
        }
    })
    .await
    .map_err(|err| anyhow!("本地 Qwen ASR 任务失败：{err}"))?
    .with_context(|| format!("无法运行 qwen_asr：{}", binary.display()))?;

    if !output.status.success() {
        return Err(anyhow!(
            "本地 Qwen ASR 失败：{}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        Err(anyhow!("本地 Qwen ASR 没有返回可用文本"))
    } else {
        Ok(text)
    }
}

pub fn build_online_server_command(_config: &AppConfig) -> Result<Command> {
    Err(anyhow!(
        "Qwen 本地 ASR 不需要启动 runtime；请使用下载并启用入口。"
    ))
}

fn list_models_blocking(
    active_model_id: &str,
    download_state: Option<&LocalAsrDownloadState>,
) -> Vec<LocalModelStatus> {
    LocalModelId::all()
        .iter()
        .copied()
        .map(|id| {
            let downloaded_bytes = downloaded_bytes(id);
            let total_bytes = cached_total_bytes(id).unwrap_or(downloaded_bytes);
            let phase = download_state
                .map(|state| state.phase(id.as_str()))
                .unwrap_or_else(|| "idle".to_string());
            let progress = if total_bytes > 0 {
                (downloaded_bytes as f64 / total_bytes as f64).clamp(0.0, 1.0)
            } else {
                0.0
            };
            LocalModelStatus {
                id: id.as_str().to_string(),
                display_name: id.display_name().to_string(),
                hf_repo: id.hf_repo().to_string(),
                downloaded_bytes,
                total_bytes,
                is_downloaded: is_model_downloaded(id),
                is_active: active_model_id == id.as_str(),
                download_phase: phase,
                download_progress: progress,
            }
        })
        .collect()
}

async fn list_models_with_state(
    active_model_id: &str,
    download_state: Option<&LocalAsrDownloadState>,
) -> Vec<LocalModelStatus> {
    list_models_blocking(active_model_id, download_state)
}

fn download_model_blocking(
    app: AppHandle,
    id: LocalModelId,
    mirror: DownloadMirror,
    download_state: Arc<LocalAsrDownloadState>,
) -> Result<()> {
    let dir = model_dir(id);
    fs::create_dir_all(&dir).with_context(|| format!("无法创建模型目录：{}", dir.display()))?;
    let files = fetch_remote_files(id, mirror)?;
    let total_bytes = files.iter().map(|file| file.size).sum::<u64>();
    fs::write(dir.join(".openless-total-bytes"), total_bytes.to_string()).ok();
    emit_progress(
        &app,
        id,
        "",
        0,
        files.len(),
        downloaded_bytes(id),
        total_bytes,
        "started",
        None,
    );

    for (index, file) in files.iter().enumerate() {
        if download_state.is_cancelled(id.as_str()) {
            download_state.set_phase(id.as_str(), "cancelled");
            emit_progress(
                &app,
                id,
                &file.path,
                index,
                files.len(),
                downloaded_bytes(id),
                total_bytes,
                "cancelled",
                None,
            );
            return Ok(());
        }
        download_state.set_phase(id.as_str(), "progress");
        download_file(
            &app,
            id,
            mirror,
            file,
            index,
            files.len(),
            total_bytes,
            &download_state,
        )?;
    }

    fs::write(dir.join(READY_SENTINEL), b"")
        .with_context(|| format!("无法写入模型完成标记：{}", dir.display()))?;
    download_state.set_phase(id.as_str(), "installing-runtime");
    emit_progress(
        &app,
        id,
        "qwen_asr",
        files.len(),
        files.len(),
        downloaded_bytes(id),
        total_bytes,
        "installing-runtime",
        None,
    );
    ensure_qwen_runtime().context("模型已下载，但本地 qwen_asr 识别引擎安装失败")?;
    download_state.set_phase(id.as_str(), "finished");
    emit_progress(
        &app,
        id,
        "",
        files.len(),
        files.len(),
        downloaded_bytes(id),
        total_bytes,
        "finished",
        None,
    );
    Ok(())
}

fn fetch_remote_files(id: LocalModelId, mirror: DownloadMirror) -> Result<Vec<RemoteFile>> {
    let url = format!(
        "{}/api/models/{}/tree/main",
        mirror.base_url(),
        id.hf_repo()
    );
    let response = reqwest::blocking::Client::builder()
        .user_agent("aria2/1.36.0")
        .build()?
        .get(&url)
        .send()
        .with_context(|| format!("无法读取模型文件清单：{url}"))?;
    if !response.status().is_success() {
        return Err(anyhow!("模型文件清单请求失败：HTTP {}", response.status()));
    }
    let entries = response.json::<Vec<HfTreeEntry>>()?;
    let files = entries
        .into_iter()
        .filter(|entry| entry.entry_type == "file" && keep_model_file(&entry.path))
        .map(|entry| RemoteFile {
            path: entry.path,
            size: entry.size.unwrap_or(0),
        })
        .collect::<Vec<_>>();
    if files.is_empty() {
        return Err(anyhow!("模型文件清单为空：{}", id.hf_repo()));
    }
    Ok(files)
}

fn download_file(
    app: &AppHandle,
    id: LocalModelId,
    mirror: DownloadMirror,
    file: &RemoteFile,
    file_index: usize,
    file_count: usize,
    total_bytes: u64,
    download_state: &LocalAsrDownloadState,
) -> Result<()> {
    let target = model_dir(id).join(&file.path);
    if target.exists() && target.metadata().map(|meta| meta.len()).unwrap_or(0) == file.size {
        emit_progress(
            app,
            id,
            &file.path,
            file_index,
            file_count,
            downloaded_bytes(id),
            total_bytes,
            "progress",
            None,
        );
        return Ok(());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    let partial = target.with_extension("partial");
    let mut start = partial
        .metadata()
        .map(|meta| meta.len())
        .unwrap_or(0)
        .min(file.size);
    let url = format!(
        "{}/{}/resolve/main/{}",
        mirror.base_url(),
        id.hf_repo(),
        file.path
    );
    let client = reqwest::blocking::Client::builder()
        .user_agent("aria2/1.36.0")
        .build()?;
    let mut file_handle = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&partial)?;

    while start < file.size {
        if download_state.is_cancelled(id.as_str()) {
            return Ok(());
        }
        let end = (start + DOWNLOAD_CHUNK_SIZE - 1).min(file.size - 1);
        let mut response = client
            .get(&url)
            .header("Range", format!("bytes={start}-{end}"))
            .send()
            .with_context(|| format!("模型文件下载失败：{url}"))?;
        if !(response.status().as_u16() == 206 || (start == 0 && response.status().is_success())) {
            return Err(anyhow!(
                "模型文件下载失败：HTTP {}，{}",
                response.status(),
                file.path
            ));
        }
        let mut buffer = [0_u8; 256 * 1024];
        loop {
            let read = response.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            file_handle.write_all(&buffer[..read])?;
            start += read as u64;
            emit_progress(
                app,
                id,
                &file.path,
                file_index,
                file_count,
                downloaded_bytes(id),
                total_bytes,
                "progress",
                None,
            );
        }
    }
    file_handle.flush()?;
    if partial.metadata().map(|meta| meta.len()).unwrap_or(0) != file.size {
        return Err(anyhow!("模型文件大小不完整：{}", file.path));
    }
    fs::rename(&partial, &target)?;
    Ok(())
}

fn emit_progress(
    app: &AppHandle,
    id: LocalModelId,
    file: &str,
    file_index: usize,
    file_count: usize,
    bytes_downloaded: u64,
    bytes_total: u64,
    phase: &str,
    error: Option<String>,
) {
    let _ = app.emit(
        "local-asr-download-progress",
        LocalAsrDownloadProgress {
            model_id: id.as_str().to_string(),
            file: file.to_string(),
            file_index,
            file_count,
            bytes_downloaded,
            bytes_total,
            phase: phase.to_string(),
            error,
        },
    );
}

fn keep_model_file(path: &str) -> bool {
    if path.starts_with('.') {
        return false;
    }
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".md")
        || lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".gif")
        || lower.ends_with(".svg")
    {
        return false;
    }
    matches!(
        lower.rsplit('.').next().unwrap_or_default(),
        "json" | "safetensors" | "txt" | "bin" | "model" | "tiktoken"
    )
}

fn parse_model_id(value: &str) -> Result<LocalModelId> {
    LocalModelId::from_str(value).ok_or_else(|| anyhow!("未知本地模型：{value}"))
}

fn is_model_downloaded(id: LocalModelId) -> bool {
    model_dir(id).join(READY_SENTINEL).exists()
}

fn downloaded_bytes(id: LocalModelId) -> u64 {
    let dir = model_dir(id);
    let mut total = 0;
    walk_files(&dir, &mut |size| total += size);
    total
}

fn cached_total_bytes(id: LocalModelId) -> Option<u64> {
    fs::read_to_string(model_dir(id).join(".openless-total-bytes"))
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
}

fn walk_files(dir: &Path, on_size: &mut impl FnMut(u64)) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name == READY_SENTINEL || name == ".openless-total-bytes" {
            continue;
        }
        match entry.file_type() {
            Ok(file_type) if file_type.is_dir() => walk_files(&path, on_size),
            Ok(file_type) if file_type.is_file() => {
                if let Ok(meta) = entry.metadata() {
                    on_size(meta.len());
                }
            }
            _ => {}
        }
    }
}

fn qwen_binary_path() -> Option<PathBuf> {
    let local = local_asr_root().join("bin").join("qwen_asr");
    if local.is_file() {
        return Some(local);
    }
    find_in_path("qwen_asr")
}

fn ensure_qwen_runtime() -> Result<PathBuf> {
    let target = local_asr_root().join("bin").join("qwen_asr");
    if target.is_file() {
        return Ok(target);
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("无法创建 qwen_asr bin 目录：{}", parent.display()))?;
    }

    let source = local_asr_root().join("runtime").join("qwen-asr");
    if !source.join(".git").is_dir() {
        if source.exists() {
            fs::remove_dir_all(&source)
                .with_context(|| format!("无法清理不完整 runtime 目录：{}", source.display()))?;
        }
        if let Some(parent) = source.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("无法创建 runtime 目录：{}", parent.display()))?;
        }
        run_command(
            Command::new("git")
                .arg("clone")
                .arg("--depth")
                .arg("1")
                .arg("https://github.com/antirez/qwen-asr.git")
                .arg(&source),
            "拉取 qwen-asr runtime 失败，请确认已安装 Git 且网络可访问 GitHub",
        )?;
    }

    run_command(
        Command::new("make").arg("blas").current_dir(&source),
        "构建 qwen_asr 失败，请先安装 Xcode Command Line Tools 后重试",
    )?;

    let built = source.join("qwen_asr");
    if !built.is_file() {
        return Err(anyhow!(
            "qwen-asr 构建完成但未生成可执行文件：{}",
            built.display()
        ));
    }
    fs::copy(&built, &target).with_context(|| {
        format!(
            "无法复制 qwen_asr 可执行文件：{} -> {}",
            built.display(),
            target.display()
        )
    })?;
    run_command(
        Command::new("chmod").arg("+x").arg(&target),
        "设置 qwen_asr 执行权限失败",
    )?;
    Ok(target)
}

fn run_command(command: &mut Command, failure_message: &str) -> Result<()> {
    let output = command
        .output()
        .with_context(|| failure_message.to_string())?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    Err(anyhow!(
        "{}：{}\n{}",
        failure_message,
        stderr.trim(),
        stdout.trim()
    ))
}

fn find_in_path(name: &str) -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    std::env::split_paths(&paths)
        .map(|dir| dir.join(name))
        .find(|path| path.is_file())
}

fn model_dir(id: LocalModelId) -> PathBuf {
    models_dir().join(id.as_str())
}

fn local_asr_root() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("OpenLessRealtimeInput")
        .join("local-asr")
}

fn models_dir() -> PathBuf {
    local_asr_root().join("models")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_qwen_model_ids() {
        assert_eq!(
            LocalModelId::from_str("qwen3-asr-0.6b"),
            Some(LocalModelId::Qwen06b)
        );
        assert_eq!(
            LocalModelId::from_str("Qwen/Qwen3-ASR-1.7B"),
            Some(LocalModelId::Qwen17b)
        );
    }

    #[test]
    fn keeps_only_model_payload_files() {
        assert!(keep_model_file("model.safetensors"));
        assert!(keep_model_file("tokenizer.json"));
        assert!(!keep_model_file("README.md"));
        assert!(!keep_model_file("image/logo.png"));
    }

    #[test]
    fn derives_models_dir_under_local_asr_root() {
        assert!(models_dir().ends_with("OpenLessRealtimeInput/local-asr/models"));
    }
}
