use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env, fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};
use tokio::task;

use crate::app_config;

const MODELS_SUBDIR: &str = "local-asr/models";
const RUNTIMES_SUBDIR: &str = "local-asr/runtimes";
const BENCHMARK_SUBDIR: &str = "local-asr/benchmarks";
const READY_SENTINEL: &str = ".openless-asr-ready";
const MODEL_FILES_SENTINEL: &str = ".openless-asr-model-ready";
const RUNTIME_READY_SENTINEL: &str = ".openless-asr-runtime-ready";
const DOWNLOAD_PROGRESS_EVENT: &str = "local-asr-download-progress";
const SHERPA_RUNTIME_ID: &str = "sherpa-onnx-v1.12.35-osx-universal2-shared-no-tts";
const SHERPA_RUNTIME_ARCHIVE: &str = "sherpa-onnx-v1.12.35-osx-universal2-shared-no-tts.tar.bz2";
const COMMAND_TIMEOUT: Duration = Duration::from_secs(22);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAsrStatus {
    pub installed: bool,
    pub runtime_reachable: bool,
    pub runtime_installed: bool,
    pub model_installed: bool,
    pub install_dir: String,
    pub runtime_binary: Option<String>,
    pub active_model_id: String,
    pub active_engine_id: String,
    pub recommended_engine_id: String,
    pub download_phase: Option<String>,
    pub download_progress: Option<f32>,
    pub models: Vec<LocalModelStatus>,
    pub engines: Vec<LocalAsrEngineStatus>,
    pub benchmark_summary: Option<BenchmarkSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalModelStatus {
    pub id: String,
    pub display_name: String,
    pub family: String,
    pub size_label: String,
    pub is_downloaded: bool,
    pub is_active: bool,
    pub download_bytes: u64,
    pub total_bytes: Option<u64>,
    pub path: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAsrEngineStatus {
    pub id: String,
    pub display_name: String,
    pub family: String,
    pub profile: String,
    pub is_downloaded: bool,
    pub is_active: bool,
    pub supports_streaming: bool,
    pub supports_prompt: bool,
    pub latency_hint_ms: Option<u32>,
    pub accuracy_hint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkSummary {
    pub last_run_at: Option<String>,
    pub best_engine_id: Option<String>,
    pub p50_first_partial_ms: Option<u32>,
    pub p95_final_ms: Option<u32>,
    pub technical_term_recall: Option<f32>,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkResult {
    pub run_id: String,
    pub engine_id: String,
    pub samples: Vec<BenchmarkSampleResult>,
    pub summary: BenchmarkSummary,
    pub output_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkSampleResult {
    pub id: String,
    pub category: String,
    pub expected: String,
    pub actual: String,
    pub final_latency_ms: u32,
    pub technical_term_hits: u32,
    pub technical_term_total: u32,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalAsrDownloadProgress {
    model_id: String,
    phase: String,
    progress: f32,
    bytes_downloaded: u64,
    bytes_total: u64,
    message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum LocalModelId {
    SenseVoiceSmall,
    FunAsrZhSmall,
    Qwen06b,
}

impl LocalModelId {
    fn all() -> Vec<Self> {
        vec![Self::SenseVoiceSmall, Self::FunAsrZhSmall, Self::Qwen06b]
    }

    fn from_str(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "sensevoice-small" | "sensevoice" | "sherpa-sensevoice-small" => {
                Some(Self::SenseVoiceSmall)
            }
            "funasr-paraformer-zh-small" | "paraformer-zh-small" | "funasr" => {
                Some(Self::FunAsrZhSmall)
            }
            "qwen3-asr-0.6b" | "qwen3-asr-06b" | "qwen3-asr" | "qwen" => Some(Self::Qwen06b),
            _ => None,
        }
    }

    fn id(self) -> &'static str {
        match self {
            Self::SenseVoiceSmall => "sensevoice-small",
            Self::FunAsrZhSmall => "funasr-paraformer-zh-small",
            Self::Qwen06b => "qwen3-asr-0.6b",
        }
    }

    fn display_name(self) -> &'static str {
        match self {
            Self::SenseVoiceSmall => "SenseVoice Small int8",
            Self::FunAsrZhSmall => "FunASR Paraformer 中文小模型",
            Self::Qwen06b => "Qwen3-ASR 0.6B int8",
        }
    }

    fn family(self) -> &'static str {
        match self {
            Self::SenseVoiceSmall => "sherpa_onnx_sensevoice",
            Self::FunAsrZhSmall => "sherpa_onnx_funasr",
            Self::Qwen06b => "sherpa_onnx_qwen",
        }
    }

    fn profile(self) -> &'static str {
        match self {
            Self::SenseVoiceSmall => "fast",
            Self::FunAsrZhSmall => "zh_fast",
            Self::Qwen06b => "accurate",
        }
    }

    fn size_label(self) -> &'static str {
        match self {
            Self::SenseVoiceSmall => "约 350 MB",
            Self::FunAsrZhSmall => "约 220 MB",
            Self::Qwen06b => "约 1.2 GB",
        }
    }

    fn accuracy_hint(self) -> &'static str {
        match self {
            Self::SenseVoiceSmall => "默认推荐：中文、英文、中英混输平衡最好，启动快。",
            Self::FunAsrZhSmall => "中文极速：中文短句更快，英文能力较弱。",
            Self::Qwen06b => "高准确率：长语音和复杂上下文更稳，但更慢更大。",
        }
    }

    fn latency_hint_ms(self) -> u32 {
        match self {
            Self::SenseVoiceSmall => 800,
            Self::FunAsrZhSmall => 650,
            Self::Qwen06b => 1500,
        }
    }

    fn source(self) -> &'static str {
        match self {
            Self::SenseVoiceSmall => {
                "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17"
            }
            Self::FunAsrZhSmall => "csukuangfj/sherpa-onnx-paraformer-zh-small-2024-03-09",
            Self::Qwen06b => "ModelScope: zengshuishui/Qwen3-ASR-onnx + Qwen/Qwen3-ASR-0.6B",
        }
    }

    fn model_root_name(self) -> &'static str {
        match self {
            Self::SenseVoiceSmall => "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17",
            Self::FunAsrZhSmall => "sherpa-onnx-paraformer-zh-small-2024-03-09",
            Self::Qwen06b => "sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25",
        }
    }

    fn required_files(self) -> Vec<&'static str> {
        match self {
            Self::SenseVoiceSmall | Self::FunAsrZhSmall => vec!["model.int8.onnx", "tokens.txt"],
            Self::Qwen06b => vec![
                "conv_frontend.onnx",
                "encoder.int8.onnx",
                "decoder.int8.onnx",
                "tokens/merges.txt",
                "tokens/tokenizer_config.json",
                "tokens/vocab.json",
            ],
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DownloadMirror {
    Huggingface,
    HfMirror,
}

impl DownloadMirror {
    fn from_str(value: Option<String>) -> Self {
        match value.as_deref().map(str::trim) {
            Some("hf-mirror") | Some("hfMirror") | Some("mirror") => Self::HfMirror,
            _ => Self::Huggingface,
        }
    }
}

#[derive(Debug, Clone)]
struct RemoteFile {
    path: &'static str,
    url: String,
    size_hint: u64,
}

#[derive(Debug, Clone)]
struct AudioQuality {
    duration_ms: u32,
    rms_db: f32,
    peak: f32,
    audible_ratio: f32,
}

pub async fn status() -> Result<LocalAsrStatus> {
    task::spawn_blocking(build_status).await?
}

pub async fn install_models() -> Result<LocalAsrStatus> {
    task::spawn_blocking(|| {
        download_model_blocking(
            LocalModelId::SenseVoiceSmall,
            DownloadMirror::Huggingface,
            None,
        )?;
        build_status()
    })
    .await?
}

pub async fn install_runtime() -> Result<LocalAsrStatus> {
    task::spawn_blocking(|| {
        ensure_sherpa_runtime(
            DownloadMirror::Huggingface,
            None,
            LocalModelId::SenseVoiceSmall,
        )?;
        build_status()
    })
    .await?
}

pub async fn open_models_dir(app: AppHandle) -> Result<String> {
    open_dir(app, models_dir())
}

pub async fn open_benchmark_dir(app: AppHandle) -> Result<String> {
    open_dir(app, benchmark_dir())
}

pub async fn list_models() -> Result<Vec<LocalModelStatus>> {
    task::spawn_blocking(|| build_status().map(|status| status.models)).await?
}

pub async fn list_engines() -> Result<Vec<LocalAsrEngineStatus>> {
    task::spawn_blocking(|| build_status().map(|status| status.engines)).await?
}

pub async fn download_model(
    app: AppHandle,
    model_id: String,
    mirror: Option<String>,
) -> Result<LocalAsrStatus> {
    let local_id = parse_model_id(&model_id)?;
    let mirror = DownloadMirror::from_str(mirror);
    task::spawn_blocking(move || {
        download_model_blocking(local_id, mirror, Some(&app))?;
        activate_model_blocking(local_id)?;
        build_status()
    })
    .await?
}

pub async fn download_engine(
    app: AppHandle,
    engine_id: String,
    mirror: Option<String>,
) -> Result<LocalAsrStatus> {
    download_model(app, engine_id, mirror).await
}

pub async fn cancel_download(_model_id: String) -> Result<LocalAsrStatus> {
    Err(anyhow!(
        "当前下载链路是同步文件下载，取消会在下一版断点续传中启用。"
    ))
}

pub async fn activate_model(model_id: String) -> Result<LocalAsrStatus> {
    let local_id = parse_model_id(&model_id)?;
    task::spawn_blocking(move || {
        activate_model_blocking(local_id)?;
        build_status()
    })
    .await?
}

pub async fn activate_engine(engine_id: String) -> Result<LocalAsrStatus> {
    activate_model(engine_id).await
}

pub async fn delete_model(model_id: String) -> Result<LocalAsrStatus> {
    let local_id = parse_model_id(&model_id)?;
    task::spawn_blocking(move || {
        let dir = model_dir(local_id);
        if dir.exists() {
            fs::remove_dir_all(&dir)
                .with_context(|| format!("删除本地模型失败：{}", dir.display()))?;
        }
        let config = app_config::load_config_from_disk().unwrap_or_default();
        let active = LocalModelId::from_str(&config.local_asr_engine_id)
            .or_else(|| LocalModelId::from_str(&config.asr_model));
        if active == Some(local_id) {
            let mut updated = config;
            updated.local_asr_engine_id = LocalModelId::SenseVoiceSmall.id().to_string();
            updated.local_asr_mode = "auto".to_string();
            updated.asr_provider = "local_hybrid".to_string();
            updated.asr_model = LocalModelId::SenseVoiceSmall.id().to_string();
            app_config::save_config_to_disk(&updated)?;
        }
        build_status()
    })
    .await?
}

pub async fn delete_engine(engine_id: String) -> Result<LocalAsrStatus> {
    delete_model(engine_id).await
}

pub async fn start_runtime() -> Result<LocalAsrStatus> {
    install_runtime().await
}

pub async fn stop_runtime() -> Result<LocalAsrStatus> {
    status().await
}

pub async fn transcribe_wav(wav_path: PathBuf) -> Result<String> {
    task::spawn_blocking(move || transcribe_wav_blocking(&wav_path)).await?
}

pub async fn run_benchmark(engine_id: String) -> Result<BenchmarkResult> {
    let local_id = parse_model_id(&engine_id)?;
    task::spawn_blocking(move || run_benchmark_blocking(local_id)).await?
}

fn parse_model_id(value: &str) -> Result<LocalModelId> {
    LocalModelId::from_str(value).ok_or_else(|| anyhow!("不支持的本地 ASR 模型或引擎：{}", value))
}

fn build_status() -> Result<LocalAsrStatus> {
    let install_dir = models_dir();
    fs::create_dir_all(&install_dir)
        .with_context(|| format!("创建本地模型目录失败：{}", install_dir.display()))?;

    let config = app_config::load_config_from_disk().unwrap_or_default();
    let preferred = LocalModelId::from_str(&config.local_asr_engine_id)
        .or_else(|| LocalModelId::from_str(&config.asr_model))
        .unwrap_or(LocalModelId::SenseVoiceSmall);
    let active = if config.asr_provider == "local_hybrid" {
        preferred
    } else {
        LocalModelId::SenseVoiceSmall
    };
    let recommended = recommended_model(&config.local_asr_mode);
    let runtime_installed = sherpa_runtime_installed();
    let model_installed = model_files_downloaded(active);
    let installed = runtime_installed && model_installed;

    let models = LocalModelId::all()
        .into_iter()
        .map(|id| model_status(id, active))
        .collect::<Result<Vec<_>>>()?;
    let engines = LocalModelId::all()
        .into_iter()
        .map(|id| engine_status(id, active, runtime_installed))
        .collect::<Vec<_>>();

    Ok(LocalAsrStatus {
        installed,
        runtime_reachable: runtime_installed,
        runtime_installed,
        model_installed,
        install_dir: install_dir.to_string_lossy().to_string(),
        runtime_binary: sherpa_binary_path()
            .filter(|path| path.exists())
            .map(|path| path.to_string_lossy().to_string()),
        active_model_id: active.id().to_string(),
        active_engine_id: active.id().to_string(),
        recommended_engine_id: recommended.id().to_string(),
        download_phase: None,
        download_progress: None,
        models,
        engines,
        benchmark_summary: Some(load_benchmark_summary().unwrap_or_else(default_benchmark_summary)),
    })
}

fn recommended_model(mode: &str) -> LocalModelId {
    match mode.trim().to_ascii_lowercase().as_str() {
        "accurate" => LocalModelId::Qwen06b,
        "zh_fast" => LocalModelId::FunAsrZhSmall,
        "fast" | "auto" | _ => LocalModelId::SenseVoiceSmall,
    }
}

fn model_status(id: LocalModelId, active: LocalModelId) -> Result<LocalModelStatus> {
    let dir = model_dir(id);
    let total = read_total_bytes(&dir);
    Ok(LocalModelStatus {
        id: id.id().to_string(),
        display_name: id.display_name().to_string(),
        family: id.family().to_string(),
        size_label: id.size_label().to_string(),
        is_downloaded: model_files_downloaded(id),
        is_active: active == id,
        download_bytes: downloaded_bytes(&dir)?,
        total_bytes: total,
        path: dir.to_string_lossy().to_string(),
        source: id.source().to_string(),
    })
}

fn engine_status(
    id: LocalModelId,
    active: LocalModelId,
    runtime_installed: bool,
) -> LocalAsrEngineStatus {
    LocalAsrEngineStatus {
        id: id.id().to_string(),
        display_name: id.display_name().to_string(),
        family: "sherpa_onnx".to_string(),
        profile: id.profile().to_string(),
        is_downloaded: runtime_installed && model_files_downloaded(id),
        is_active: active == id,
        supports_streaming: false,
        supports_prompt: false,
        latency_hint_ms: Some(id.latency_hint_ms()),
        accuracy_hint: id.accuracy_hint().to_string(),
    }
}

fn download_model_blocking(
    id: LocalModelId,
    mirror: DownloadMirror,
    app: Option<&AppHandle>,
) -> Result<()> {
    emit_progress(app, id, "preparing", 0.0, 0, 0, "准备本地 ASR runtime");
    ensure_sherpa_runtime(mirror, app, id)?;

    let dir = model_dir(id);
    let root_dir = model_root_dir(id);
    fs::create_dir_all(&root_dir)
        .with_context(|| format!("创建模型目录失败：{}", root_dir.display()))?;
    let files = remote_model_files(id, mirror);
    let total_bytes = files.iter().map(|file| file.size_hint).sum::<u64>();
    write_total_bytes(&dir, total_bytes)?;

    let mut downloaded = downloaded_bytes(&dir).unwrap_or(0);
    emit_progress(
        app,
        id,
        "downloading-model",
        progress(downloaded, total_bytes),
        downloaded,
        total_bytes,
        "正在下载本地 ASR 模型",
    );

    for file in files {
        if !is_safe_remote_model_path(file.path) || !keep_model_file(file.path) {
            return Err(anyhow!("拒绝不安全的模型文件路径：{}", file.path));
        }
        let target = root_dir.join(file.path);
        if target.exists() && target.metadata().map(|meta| meta.len()).unwrap_or(0) > 0 {
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        download_url_to_path(&file.url, &target)
            .with_context(|| format!("下载模型文件失败：{}", file.url))?;
        downloaded = downloaded_bytes(&dir).unwrap_or(downloaded);
        emit_progress(
            app,
            id,
            "downloading-model",
            progress(downloaded, total_bytes),
            downloaded,
            total_bytes,
            format!("已下载 {}", file.path),
        );
    }

    validate_model_files(id)?;
    fs::write(dir.join(MODEL_FILES_SENTINEL), "ok")?;
    fs::write(dir.join(READY_SENTINEL), "ok")?;
    emit_progress(
        app,
        id,
        "finished",
        100.0,
        total_bytes,
        total_bytes,
        "模型已下载完成",
    );
    Ok(())
}

fn ensure_sherpa_runtime(
    mirror: DownloadMirror,
    app: Option<&AppHandle>,
    progress_model_id: LocalModelId,
) -> Result<()> {
    if sherpa_runtime_installed() {
        return Ok(());
    }

    let runtime_dir = runtimes_dir();
    fs::create_dir_all(&runtime_dir)
        .with_context(|| format!("创建 runtime 目录失败：{}", runtime_dir.display()))?;
    let archive_path = runtime_dir.join(SHERPA_RUNTIME_ARCHIVE);
    let url = match mirror {
        DownloadMirror::Huggingface => format!(
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.12.35/{SHERPA_RUNTIME_ARCHIVE}"
        ),
        DownloadMirror::HfMirror => format!(
            "https://sourceforge.net/projects/sherpa-onnx.mirror/files/v1.12.35/{SHERPA_RUNTIME_ARCHIVE}/download"
        ),
    };

    emit_progress(
        app,
        progress_model_id,
        "downloading-runtime",
        0.0,
        0,
        0,
        "正在下载 Sherpa-ONNX runtime",
    );
    if !archive_path.exists() || archive_path.metadata().map(|meta| meta.len()).unwrap_or(0) == 0 {
        download_url_to_path(&url, &archive_path)
            .with_context(|| "下载 Sherpa-ONNX runtime 失败")?;
    }

    emit_progress(
        app,
        progress_model_id,
        "extracting-runtime",
        0.0,
        0,
        0,
        "正在解压 Sherpa-ONNX runtime",
    );
    let output = Command::new("/usr/bin/tar")
        .arg("-xjf")
        .arg(&archive_path)
        .arg("-C")
        .arg(&runtime_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .with_context(|| "执行 tar 解压 Sherpa-ONNX runtime 失败")?;
    if !output.status.success() {
        return Err(anyhow!(
            "解压 Sherpa-ONNX runtime 失败：{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    validate_sherpa_runtime()?;
    fs::write(sherpa_runtime_dir().join(RUNTIME_READY_SENTINEL), "ok")?;
    Ok(())
}

fn activate_model_blocking(id: LocalModelId) -> Result<()> {
    validate_sherpa_runtime().context("Sherpa-ONNX runtime 未安装或损坏，请先下载并启用模型")?;
    validate_model_files(id).with_context(|| format!("模型 {} 未下载完整", id.display_name()))?;

    let mut config = app_config::load_config_from_disk().unwrap_or_default();
    config.asr_provider = "local_hybrid".to_string();
    config.asr_model = id.id().to_string();
    config.local_asr_engine_id = id.id().to_string();
    if config.local_asr_mode.trim().is_empty() {
        config.local_asr_mode = "auto".to_string();
    }
    app_config::save_config_to_disk(&config)?;
    Ok(())
}

fn transcribe_wav_blocking(wav_path: &Path) -> Result<String> {
    let quality = analyze_wav_audio(wav_path).unwrap_or(AudioQuality {
        duration_ms: 0,
        rms_db: -120.0,
        peak: 0.0,
        audible_ratio: 0.0,
    });
    if !is_audible(&quality) {
        return Err(anyhow!(
            "未检测到有效语音：时长 {} ms，RMS {:.1} dB，峰值 {:.3}，有效占比 {:.1}%",
            quality.duration_ms,
            quality.rms_db,
            quality.peak,
            quality.audible_ratio * 100.0
        ));
    }

    let config = app_config::load_config_from_disk().unwrap_or_default();
    let active = LocalModelId::from_str(&config.local_asr_engine_id)
        .or_else(|| LocalModelId::from_str(&config.asr_model))
        .unwrap_or(LocalModelId::SenseVoiceSmall);
    let mut candidates = vec![active];
    for candidate in [
        recommended_model(&config.local_asr_mode),
        LocalModelId::SenseVoiceSmall,
        LocalModelId::FunAsrZhSmall,
        LocalModelId::Qwen06b,
    ] {
        if !candidates.contains(&candidate) {
            candidates.push(candidate);
        }
    }

    let mut first_error: Option<anyhow::Error> = None;
    for candidate in candidates {
        if !sherpa_runtime_installed() || !model_files_downloaded(candidate) {
            continue;
        }
        match run_sherpa_asr_command(candidate, wav_path) {
            Ok(text) if !text.trim().is_empty() => {
                let normalized = apply_local_technical_terms(&text);
                if is_low_information_transcript(&normalized) {
                    if first_error.is_none() {
                        first_error = Some(anyhow!(
                            "{} 只返回低信息文本：{}",
                            candidate.display_name(),
                            normalized
                        ));
                    }
                    continue;
                }
                return Ok(normalized);
            }
            Ok(_) => {
                if first_error.is_none() {
                    first_error = Some(anyhow!("{} 返回空文本", candidate.display_name()));
                }
            }
            Err(error) => {
                if first_error.is_none() {
                    first_error = Some(error);
                }
            }
        }
    }

    Err(first_error.unwrap_or_else(|| {
        anyhow!("本地 ASR 不可用：请先下载并启用 SenseVoice Small 或切换到云端 ASR")
    }))
}

fn run_sherpa_asr_command(id: LocalModelId, wav_path: &Path) -> Result<String> {
    match id {
        LocalModelId::SenseVoiceSmall => run_sensevoice(wav_path),
        LocalModelId::FunAsrZhSmall => run_funasr(wav_path),
        LocalModelId::Qwen06b => run_qwen_sherpa(wav_path),
    }
}

fn run_sensevoice(wav_path: &Path) -> Result<String> {
    let output = run_sensevoice_with_language(wav_path, "auto")?;
    let text = parse_sherpa_stdout(&output)?;
    if looks_like_japanese_or_korean(&text) || is_low_information_transcript(&text) {
        let retry = run_sensevoice_with_language(wav_path, "zh")?;
        return parse_sherpa_stdout(&retry);
    }
    Ok(text)
}

fn run_sensevoice_with_language(wav_path: &Path, language: &str) -> Result<Output> {
    let root = model_root_dir(LocalModelId::SenseVoiceSmall);
    let mut command =
        Command::new(sherpa_binary_path().ok_or_else(|| anyhow!("Sherpa runtime 缺失"))?);
    command
        .arg("--print-args=false")
        .arg(format!("--tokens={}", root.join("tokens.txt").display()))
        .arg(format!(
            "--sense-voice-model={}",
            root.join("model.int8.onnx").display()
        ))
        .arg(format!("--sense-voice-language={language}"))
        .arg("--sense-voice-use-itn=true")
        .arg("--provider=cpu")
        .arg(wav_path);
    command_output_with_timeout(&mut command, COMMAND_TIMEOUT)
}

fn run_funasr(wav_path: &Path) -> Result<String> {
    let root = model_root_dir(LocalModelId::FunAsrZhSmall);
    let mut command =
        Command::new(sherpa_binary_path().ok_or_else(|| anyhow!("Sherpa runtime 缺失"))?);
    command
        .arg("--print-args=false")
        .arg(format!("--tokens={}", root.join("tokens.txt").display()))
        .arg(format!(
            "--paraformer={}",
            root.join("model.int8.onnx").display()
        ))
        .arg("--provider=cpu")
        .arg(wav_path);
    parse_sherpa_stdout(&command_output_with_timeout(&mut command, COMMAND_TIMEOUT)?)
}

fn run_qwen_sherpa(wav_path: &Path) -> Result<String> {
    let root = model_root_dir(LocalModelId::Qwen06b);
    let mut command =
        Command::new(sherpa_binary_path().ok_or_else(|| anyhow!("Sherpa runtime 缺失"))?);
    command
        .arg("--print-args=false")
        .arg(format!(
            "--qwen3-asr-conv-frontend={}",
            root.join("conv_frontend.onnx").display()
        ))
        .arg(format!(
            "--qwen3-asr-encoder={}",
            root.join("encoder.int8.onnx").display()
        ))
        .arg(format!(
            "--qwen3-asr-decoder={}",
            root.join("decoder.int8.onnx").display()
        ))
        .arg(format!(
            "--qwen3-asr-tokenizer={}",
            root.join("tokens").display()
        ))
        .arg("--qwen3-asr-max-total-len=1500")
        .arg("--qwen3-asr-max-new-tokens=512")
        .arg("--qwen3-asr-temperature=0")
        .arg("--provider=cpu")
        .arg(wav_path);
    parse_sherpa_stdout(&command_output_with_timeout(&mut command, COMMAND_TIMEOUT)?)
}

fn parse_sherpa_stdout(output: &Output) -> Result<String> {
    if !output.status.success() {
        return Err(anyhow!(
            "Sherpa-ONNX 识别失败：{}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if let Some(text) = extract_sherpa_transcript(&stdout) {
        return Ok(text);
    }
    if let Some(text) = extract_sherpa_transcript(&stderr) {
        return Ok(text);
    }
    Ok(String::new())
}

fn extract_sherpa_transcript(output: &str) -> Option<String> {
    output
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || is_sherpa_metadata_line(line) {
                return None;
            }
            if line.starts_with('{') {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(line) {
                    if let Some(text) = value.get("text").and_then(|value| value.as_str()) {
                        let cleaned = clean_transcript(text);
                        return (!cleaned.is_empty()).then_some(cleaned);
                    }
                }
            }
            let cleaned = clean_transcript(line);
            (!cleaned.is_empty()).then_some(cleaned)
        })
        .last()
}

fn is_sherpa_metadata_line(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    lower.contains("real time factor")
        || lower.starts_with("rtf")
        || lower.starts_with("started")
        || lower.starts_with("finished")
        || lower.starts_with("loading")
        || lower.starts_with("creating")
        || lower.starts_with("decoding")
        || lower.starts_with("usage:")
        || lower.starts_with("warning:")
        || lower.ends_with(".wav")
        || lower.ends_with(".flac")
        || lower.ends_with(".mp3")
        || lower.ends_with(".m4a")
}

fn clean_transcript(text: &str) -> String {
    text.replace("<|zh|>", "")
        .replace("<|en|>", "")
        .replace("<|ja|>", "")
        .replace("<|ko|>", "")
        .replace("<|yue|>", "")
        .replace("<|withitn|>", "")
        .replace("<|woitn|>", "")
        .trim()
        .to_string()
}

fn looks_like_japanese_or_korean(text: &str) -> bool {
    text.chars().any(|ch| {
        ('\u{3040}'..='\u{30ff}').contains(&ch) || ('\u{ac00}'..='\u{d7af}').contains(&ch)
    })
}

fn is_low_information_transcript(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return true;
    }
    let meaningful = trimmed
        .chars()
        .filter(|ch| ch.is_alphanumeric() || is_cjk_unified(*ch))
        .count();
    meaningful == 0 || (meaningful == 1 && trimmed.chars().count() <= 2)
}

fn is_cjk_unified(ch: char) -> bool {
    ('\u{4e00}'..='\u{9fff}').contains(&ch)
}

fn apply_local_technical_terms(text: &str) -> String {
    let mut output = text.to_string();
    for (alias, canonical) in [
        ("claude code", "Claude Code"),
        ("cloud code", "Claude Code"),
        ("clode code", "Claude Code"),
        ("openai codex", "OpenAI Codex"),
        ("open ai codex", "OpenAI Codex"),
        ("codeex", "Codex"),
        ("codex", "Codex"),
        ("tauri", "Tauri"),
        ("src tauri", "src-tauri"),
        ("src-tauri", "src-tauri"),
        ("transcript event", "TranscriptEvent"),
        ("shadow buffer", "ShadowBuffer"),
        ("typescript", "TypeScript"),
        ("rust", "Rust"),
        ("react", "React"),
        ("vite", "Vite"),
        ("gpt", "GPT"),
    ] {
        output = replace_ascii_case_insensitive(&output, alias, canonical);
    }
    output
}

fn replace_ascii_case_insensitive(input: &str, needle: &str, replacement: &str) -> String {
    let lowered = input.to_ascii_lowercase();
    let needle = needle.to_ascii_lowercase();
    if !lowered.contains(&needle) {
        return input.to_string();
    }

    let mut result = String::with_capacity(input.len());
    let mut cursor = 0;
    while let Some(relative) = lowered[cursor..].find(&needle) {
        let start = cursor + relative;
        let end = start + needle.len();
        result.push_str(&input[cursor..start]);
        result.push_str(replacement);
        cursor = end;
    }
    result.push_str(&input[cursor..]);
    result
}

fn remote_model_files(id: LocalModelId, mirror: DownloadMirror) -> Vec<RemoteFile> {
    match id {
        LocalModelId::SenseVoiceSmall => {
            let base = match mirror {
                DownloadMirror::Huggingface => "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main",
                DownloadMirror::HfMirror => "https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main",
            };
            vec![
                RemoteFile {
                    path: "model.int8.onnx",
                    url: format!("{base}/model.int8.onnx"),
                    size_hint: 360 * 1024 * 1024,
                },
                RemoteFile {
                    path: "tokens.txt",
                    url: format!("{base}/tokens.txt"),
                    size_hint: 2 * 1024 * 1024,
                },
            ]
        }
        LocalModelId::FunAsrZhSmall => {
            let base = match mirror {
                DownloadMirror::Huggingface => "https://huggingface.co/csukuangfj/sherpa-onnx-paraformer-zh-small-2024-03-09/resolve/main",
                DownloadMirror::HfMirror => "https://hf-mirror.com/csukuangfj/sherpa-onnx-paraformer-zh-small-2024-03-09/resolve/main",
            };
            vec![
                RemoteFile {
                    path: "model.int8.onnx",
                    url: format!("{base}/model.int8.onnx"),
                    size_hint: 220 * 1024 * 1024,
                },
                RemoteFile {
                    path: "tokens.txt",
                    url: format!("{base}/tokens.txt"),
                    size_hint: 2 * 1024 * 1024,
                },
            ]
        }
        LocalModelId::Qwen06b => vec![
            RemoteFile {
                path: "conv_frontend.onnx",
                url: "https://modelscope.cn/models/zengshuishui/Qwen3-ASR-onnx/resolve/master/model_0.6B/conv_frontend.onnx".to_string(),
                size_hint: 20 * 1024 * 1024,
            },
            RemoteFile {
                path: "encoder.int8.onnx",
                url: "https://modelscope.cn/models/zengshuishui/Qwen3-ASR-onnx/resolve/master/model_0.6B/encoder.int8.onnx".to_string(),
                size_hint: 850 * 1024 * 1024,
            },
            RemoteFile {
                path: "decoder.int8.onnx",
                url: "https://modelscope.cn/models/zengshuishui/Qwen3-ASR-onnx/resolve/master/model_0.6B/decoder.int8.onnx".to_string(),
                size_hint: 280 * 1024 * 1024,
            },
            RemoteFile {
                path: "tokens/merges.txt",
                url: "https://modelscope.cn/models/Qwen/Qwen3-ASR-0.6B/resolve/master/merges.txt".to_string(),
                size_hint: 512 * 1024,
            },
            RemoteFile {
                path: "tokens/tokenizer_config.json",
                url: "https://modelscope.cn/models/Qwen/Qwen3-ASR-0.6B/resolve/master/tokenizer_config.json".to_string(),
                size_hint: 64 * 1024,
            },
            RemoteFile {
                path: "tokens/vocab.json",
                url: "https://modelscope.cn/models/Qwen/Qwen3-ASR-0.6B/resolve/master/vocab.json".to_string(),
                size_hint: 2 * 1024 * 1024,
            },
        ],
    }
}

fn download_url_to_path(url: &str, target: &Path) -> Result<()> {
    let partial = target.with_extension("partial");
    let mut response = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(900))
        .build()?
        .get(url)
        .send()
        .with_context(|| format!("请求失败：{url}"))?;
    if !response.status().is_success() {
        return Err(anyhow!("HTTP {}：{}", response.status(), url));
    }

    let mut file = fs::File::create(&partial)?;
    let mut buffer = [0_u8; 256 * 1024];
    loop {
        let read = response.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read])?;
    }
    file.flush()?;
    fs::rename(&partial, target)?;
    Ok(())
}

fn validate_sherpa_runtime() -> Result<()> {
    let root = sherpa_runtime_dir();
    for relative in [
        "bin/sherpa-onnx-offline",
        "lib/libsherpa-onnx-c-api.dylib",
        "lib/libonnxruntime.dylib",
        "lib/libonnxruntime.1.23.2.dylib",
    ] {
        let path = root.join(relative);
        let metadata = path
            .metadata()
            .with_context(|| format!("Sherpa runtime 缺少文件：{}", path.display()))?;
        if !metadata.is_file() || metadata.len() == 0 {
            return Err(anyhow!("Sherpa runtime 文件无效：{}", path.display()));
        }
    }
    Ok(())
}

fn validate_model_files(id: LocalModelId) -> Result<()> {
    let root = model_root_dir(id);
    for relative in id.required_files() {
        let path = root.join(relative);
        let metadata = path
            .metadata()
            .with_context(|| format!("模型缺少文件：{}", path.display()))?;
        if !metadata.is_file() || metadata.len() == 0 {
            return Err(anyhow!("模型文件无效：{}", path.display()));
        }
    }
    Ok(())
}

fn sherpa_runtime_installed() -> bool {
    validate_sherpa_runtime().is_ok()
}

fn model_files_downloaded(id: LocalModelId) -> bool {
    validate_model_files(id).is_ok()
}

fn is_engine_downloaded(id: LocalModelId) -> bool {
    sherpa_runtime_installed() && model_files_downloaded(id)
}

fn model_dir(id: LocalModelId) -> PathBuf {
    models_dir().join(id.id())
}

fn model_root_dir(id: LocalModelId) -> PathBuf {
    model_dir(id).join(id.model_root_name())
}

fn sherpa_runtime_dir() -> PathBuf {
    runtimes_dir().join(SHERPA_RUNTIME_ID)
}

fn sherpa_binary_path() -> Option<PathBuf> {
    Some(sherpa_runtime_dir().join("bin/sherpa-onnx-offline"))
}

fn local_asr_root() -> PathBuf {
    app_support_dir().unwrap_or_else(|| {
        env::var("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("Library/Application Support/OpenLessRealtimeInput")
    })
}

fn app_support_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join("OpenLessRealtimeInput"))
}

fn models_dir() -> PathBuf {
    local_asr_root().join(MODELS_SUBDIR)
}

fn runtimes_dir() -> PathBuf {
    local_asr_root().join(RUNTIMES_SUBDIR)
}

fn benchmark_dir() -> PathBuf {
    local_asr_root().join(BENCHMARK_SUBDIR)
}

fn open_dir(app: AppHandle, dir: PathBuf) -> Result<String> {
    fs::create_dir_all(&dir).with_context(|| format!("创建目录失败：{}", dir.display()))?;
    let output = Command::new("open")
        .arg(&dir)
        .output()
        .with_context(|| format!("打开 Finder 失败：{}", dir.display()))?;
    if !output.status.success() {
        return Err(anyhow!(
            "打开 Finder 失败：{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let _ = app.emit(
        "local-asr-dir-opened",
        HashMap::from([("path", dir.to_string_lossy().to_string())]),
    );
    Ok(dir.to_string_lossy().to_string())
}

fn emit_progress<M: Into<String>>(
    app: Option<&AppHandle>,
    model_id: LocalModelId,
    phase: &str,
    progress_value: f32,
    bytes_downloaded: u64,
    bytes_total: u64,
    message: M,
) {
    if let Some(app) = app {
        let payload = LocalAsrDownloadProgress {
            model_id: model_id.id().to_string(),
            phase: phase.to_string(),
            progress: progress_value,
            bytes_downloaded,
            bytes_total,
            message: message.into(),
        };
        let _ = app.emit(DOWNLOAD_PROGRESS_EVENT, payload);
    }
}

fn progress(downloaded: u64, total: u64) -> f32 {
    if total == 0 {
        0.0
    } else {
        ((downloaded as f32 / total as f32) * 100.0).clamp(0.0, 100.0)
    }
}

fn downloaded_bytes(dir: &Path) -> Result<u64> {
    if !dir.exists() {
        return Ok(0);
    }
    downloaded_bytes_recursive(dir)
}

fn downloaded_bytes_recursive(dir: &Path) -> Result<u64> {
    let mut total = 0;
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let metadata = entry.metadata()?;
        if metadata.is_dir() {
            total += downloaded_bytes_recursive(&path)?;
        } else if metadata.is_file() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name == READY_SENTINEL
                || name == MODEL_FILES_SENTINEL
                || name == ".openless-total-bytes"
            {
                continue;
            }
            total += metadata.len();
        }
    }
    Ok(total)
}

fn write_total_bytes(dir: &Path, total: u64) -> Result<()> {
    fs::write(dir.join(".openless-total-bytes"), total.to_string())?;
    Ok(())
}

fn read_total_bytes(dir: &Path) -> Option<u64> {
    fs::read_to_string(dir.join(".openless-total-bytes"))
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
}

fn is_safe_remote_model_path(path: &str) -> bool {
    if path.trim().is_empty()
        || path.starts_with('/')
        || path.starts_with('~')
        || path.contains("..")
        || path.contains('\\')
        || path.contains(':')
    {
        return false;
    }
    Path::new(path)
        .components()
        .all(|component| matches!(component, std::path::Component::Normal(_)))
}

fn keep_model_file(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    [".onnx", ".txt", ".json"]
        .iter()
        .any(|ext| lower.ends_with(ext))
}

fn analyze_wav_audio(wav_path: &Path) -> Result<AudioQuality> {
    let mut reader = hound::WavReader::open(wav_path)?;
    let spec = reader.spec();
    let mut count = 0_u64;
    let mut sum_square = 0.0_f64;
    let mut peak = 0.0_f32;
    let mut audible = 0_u64;

    for sample in reader.samples::<i16>() {
        let value = sample? as f32 / i16::MAX as f32;
        let abs = value.abs();
        peak = peak.max(abs);
        sum_square += (value as f64) * (value as f64);
        if abs > 0.012 {
            audible += 1;
        }
        count += 1;
    }

    if count == 0 {
        return Ok(AudioQuality {
            duration_ms: 0,
            rms_db: -120.0,
            peak: 0.0,
            audible_ratio: 0.0,
        });
    }
    let rms = (sum_square / count as f64).sqrt() as f32;
    let rms_db = 20.0 * rms.max(1e-6).log10();
    let duration_ms = ((count as f64 / spec.sample_rate as f64) * 1000.0).round() as u32;
    Ok(AudioQuality {
        duration_ms,
        rms_db,
        peak,
        audible_ratio: audible as f32 / count as f32,
    })
}

fn is_audible(quality: &AudioQuality) -> bool {
    quality.duration_ms >= 180
        && quality.peak >= 0.018
        && quality.rms_db >= -45.0
        && quality.audible_ratio >= 0.015
}

fn run_benchmark_blocking(engine: LocalModelId) -> Result<BenchmarkResult> {
    if !is_engine_downloaded(engine) {
        return Err(anyhow!("本地引擎未下载完整：{}", engine.display_name()));
    }

    let run_id = unix_timestamp_secs().to_string();
    let samples = benchmark_samples();
    let mut results = Vec::new();
    for sample in samples {
        let started = Instant::now();
        let actual = "需要真实音频样本后运行端到端 benchmark".to_string();
        let latency = started.elapsed().as_millis().min(u128::from(u32::MAX)) as u32;
        results.push(BenchmarkSampleResult {
            id: sample.0.to_string(),
            category: sample.1.to_string(),
            expected: sample.2.to_string(),
            actual,
            final_latency_ms: latency,
            technical_term_hits: 0,
            technical_term_total: technical_term_count(sample.2),
            success: false,
            error: Some("缺少标准测试音频，当前只生成 benchmark 框架。".to_string()),
        });
    }

    let summary = BenchmarkSummary {
        last_run_at: Some(unix_timestamp_secs().to_string()),
        best_engine_id: Some(LocalModelId::SenseVoiceSmall.id().to_string()),
        p50_first_partial_ms: None,
        p95_final_ms: None,
        technical_term_recall: None,
        note: "已建立本地 benchmark 结果结构；真实评分需要录制或导入标准音频。".to_string(),
    };
    let output_dir = benchmark_dir();
    fs::create_dir_all(&output_dir)?;
    let output_path = output_dir.join(format!("benchmark-{run_id}.json"));
    let result = BenchmarkResult {
        run_id,
        engine_id: engine.id().to_string(),
        samples: results,
        summary: summary.clone(),
        output_path: output_path.to_string_lossy().to_string(),
    };
    fs::write(&output_path, serde_json::to_string_pretty(&result)?)?;
    fs::write(
        output_dir.join("latest-summary.json"),
        serde_json::to_string_pretty(&summary)?,
    )?;
    Ok(result)
}

fn benchmark_samples() -> Vec<(&'static str, &'static str, &'static str)> {
    vec![
        ("zh-short-1", "中文短句", "请帮我打开设置页面。"),
        ("en-tech-1", "英文技术词", "Claude Code and OpenAI Codex"),
        (
            "mix-tech-1",
            "中英混输",
            "我要使用 Claude Code 调用 OpenAI Codex。",
        ),
        (
            "mix-tech-2",
            "中英混输",
            "Tauri、src-tauri、TranscriptEvent 和 ShadowBuffer。",
        ),
        ("empty-1", "空录音", ""),
    ]
}

fn technical_term_count(text: &str) -> u32 {
    let terms = [
        "Claude Code",
        "OpenAI Codex",
        "Tauri",
        "src-tauri",
        "TranscriptEvent",
        "ShadowBuffer",
        "TypeScript",
        "Rust",
        "React",
        "Vite",
        "GPT",
    ];
    terms.iter().filter(|term| text.contains(**term)).count() as u32
}

fn load_benchmark_summary() -> Option<BenchmarkSummary> {
    let path = benchmark_dir().join("latest-summary.json");
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str::<BenchmarkSummary>(&content).ok())
}

fn default_benchmark_summary() -> BenchmarkSummary {
    BenchmarkSummary {
        last_run_at: None,
        best_engine_id: Some(LocalModelId::SenseVoiceSmall.id().to_string()),
        p50_first_partial_ms: None,
        p95_final_ms: None,
        technical_term_recall: None,
        note: "未运行本地 benchmark；默认推荐 SenseVoice Small。".to_string(),
    }
}

fn unix_timestamp_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn command_output_with_timeout(command: &mut Command, timeout: Duration) -> Result<Output> {
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .with_context(|| "启动本地 ASR 命令失败")?;
    let start = Instant::now();
    loop {
        if child.try_wait()?.is_some() {
            return child.wait_with_output().map_err(Into::into);
        }
        if start.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(anyhow!(
                "本地 ASR 超时，请检查模型是否过大或 runtime 是否损坏"
            ));
        }
        thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_local_model_ids() {
        assert_eq!(
            LocalModelId::from_str("sensevoice-small").unwrap().id(),
            "sensevoice-small"
        );
        assert_eq!(
            LocalModelId::from_str("funasr-paraformer-zh-small")
                .unwrap()
                .id(),
            "funasr-paraformer-zh-small"
        );
        assert_eq!(
            LocalModelId::from_str("qwen3-asr-0.6b").unwrap().id(),
            "qwen3-asr-0.6b"
        );
        assert!(LocalModelId::from_str("qwen3-asr-1.7b").is_none());
    }

    #[test]
    fn rejects_unsafe_remote_paths() {
        for path in [
            "",
            "../secret",
            "/tmp/model.onnx",
            "a/../../b",
            "C:\\model.onnx",
        ] {
            assert!(!is_safe_remote_model_path(path), "{path}");
        }
        assert!(is_safe_remote_model_path("tokens/vocab.json"));
        assert!(is_safe_remote_model_path("model.int8.onnx"));
    }

    #[test]
    fn keeps_only_model_payload_files() {
        assert!(keep_model_file("model.int8.onnx"));
        assert!(keep_model_file("tokens.txt"));
        assert!(keep_model_file("tokens/tokenizer_config.json"));
        assert!(!keep_model_file("README.md"));
        assert!(!keep_model_file("run.sh"));
    }

    #[test]
    fn command_output_with_timeout_captures_stdout() {
        let mut command = Command::new("/bin/sh");
        command.arg("-c").arg("printf ok");
        let output = command_output_with_timeout(&mut command, Duration::from_secs(2)).unwrap();
        assert_eq!(String::from_utf8_lossy(&output.stdout), "ok");
    }

    #[test]
    fn command_output_with_timeout_kills_long_process() {
        let mut command = Command::new("/bin/sh");
        command.arg("-c").arg("sleep 2");
        let err = command_output_with_timeout(&mut command, Duration::from_millis(50)).unwrap_err();
        assert!(err.to_string().contains("超时"));
    }

    #[test]
    fn derives_models_dir() {
        let dir = models_dir();
        assert!(dir.to_string_lossy().contains("local-asr/models"));
    }

    #[test]
    fn detects_japanese_or_korean_output() {
        assert!(looks_like_japanese_or_korean("このクラウド"));
        assert!(looks_like_japanese_or_korean("안녕하세요"));
        assert!(!looks_like_japanese_or_korean("Claude Code"));
    }

    #[test]
    fn parses_transcript_before_sherpa_rtf_log() {
        let mut command = Command::new("/bin/sh");
        command.arg("-c").arg(
            "printf '现在已经下了本地模型\\nReal time factor (RTF): 0.032 / 1.088 = 0.029\\n'",
        );
        let output = command_output_with_timeout(&mut command, Duration::from_secs(2)).unwrap();
        let transcript = parse_sherpa_stdout(&output).unwrap();
        assert_eq!(transcript, "现在已经下了本地模型");
    }

    #[test]
    fn skips_sherpa_audio_path_line() {
        let mut command = Command::new("/bin/sh");
        command
            .arg("-c")
            .arg("printf '/tmp/audio.wav\\n现在已经下了本地模型\\n'");
        let output = command_output_with_timeout(&mut command, Duration::from_secs(2)).unwrap();
        let transcript = parse_sherpa_stdout(&output).unwrap();
        assert_eq!(transcript, "现在已经下了本地模型");
    }

    #[test]
    fn marks_punctuation_only_transcript_as_low_information() {
        assert!(is_low_information_transcript("。"));
        assert!(is_low_information_transcript("."));
        assert!(!is_low_information_transcript("能不能再快一点"));
        assert!(!is_low_information_transcript("Claude Code"));
    }
}
