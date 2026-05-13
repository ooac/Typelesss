import {
  CloudCog,
  Cpu,
  Database,
  Key,
  Link2,
  RefreshCcw,
  AudioLines,
  FolderOpen,
  Wrench,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState, type FocusEvent } from "react";
import { HealthChip } from "./HealthChip.js";
import { ProviderRow } from "./ProviderRow.js";
import { SecretField } from "./SecretField.js";
import {
  autoOptimizedDefaults,
  localHybridDefaults,
  stepfunRealtimeDefaults,
  tencentRealtimeDefaults,
  whisperCompatibleDefaults,
} from "../appDefaults.js";
import { useHealth } from "../health/HealthContext.js";
import { useApp } from "../state/AppContext.js";
import type {
  AppConfig,
  AsrProvider,
  LocalAsrMode,
  LocalAsrDownloadProgress,
  LocalAsrBenchmarkResult,
  LocalAsrModelStatus,
  LocalAsrStatus,
  PolishProvider,
} from "../appTypes.js";
import type { DictationMode } from "../types.js";

type EditorId =
  | "asrProvider"
  | "asrModel"
  | "asrEndpoint"
  | "asrApiKey"
  | "volcengine"
  | "tencent"
  | "polishProvider"
  | "polishEndpoint"
  | "polishApiKey"
  | "polishModel"
  | "outputMode";

const ASR_PROVIDER_LABEL: Record<AsrProvider, string> = {
  auto_optimized: "极速自动 ASR",
  local_hybrid: "本地混合 ASR",
  whisper_compatible: "硅基流动 / Whisper-compatible",
  stepfun_streaming: "StepFun 实时 ASR",
  volcengine: "Volcengine streaming",
  tencent_realtime: "腾讯云实时 ASR",
};

const POLISH_PROVIDER_LABEL: Record<PolishProvider, string> = {
  openai_compatible: "DeepSeek / OpenAI-compatible",
  disabled: "已禁用",
};

const OUTPUT_MODE_LABEL: Record<DictationMode, string> = {
  fast_dictation: "快速听写",
  smart_polish: "智能润色",
  prompt_builder: "提示词构建",
  code_prompt: "代码提示词",
};

interface ProviderEditorProps {
  showRefresh?: boolean;
  showAutoInsertRow?: boolean;
}

/**
 * Reusable list of provider/config rows + drawer editor.
 * Used by both ProvidersPage (full page) and RealtimePage's right inspector.
 */
export function ProviderEditor({
  showRefresh = true,
  showAutoInsertRow = true,
}: ProviderEditorProps) {
  const { config, setConfig, updateAndSaveConfig } = useApp();
  const { asr, polish, secrets, refresh, loading } = useHealth();
  const [editing, setEditing] = useState<EditorId | null>(null);
  const [draft, setDraft] = useState<AppConfig>(config);
  const [localStatus, setLocalStatus] = useState<LocalAsrStatus | null>(null);
  const [localBusy, setLocalBusy] = useState(false);
  const [localMessage, setLocalMessage] = useState("");
  const [localProgress, setLocalProgress] = useState<Record<string, LocalAsrDownloadProgress>>({});

  const saveDraft = useCallback(async () => {
    const patch = diffPatch(config, draft);
    if (Object.keys(patch).length === 0) return;
    await updateAndSaveConfig(patch);
  }, [config, draft, updateAndSaveConfig]);

  const openEditor = useCallback(
    async (id: EditorId) => {
      if (editing === id) {
        await saveDraft();
        setEditing(null);
        return;
      }
      if (editing) {
        await saveDraft();
      }
      const patch = diffPatch(config, draft);
      const base = Object.keys(patch).length > 0 ? ({ ...config, ...patch } as AppConfig) : config;
      setDraft(base);
      setEditing(id);
    },
    [config, draft, editing, saveDraft],
  );

  const handleInlineBlur = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      const next = event.relatedTarget as Node | null;
      if (next && event.currentTarget.contains(next)) return;
      void saveDraft();
      setEditing(null);
    },
    [saveDraft],
  );

  const isAsrVolcengine = config.asrProvider === "volcengine";
  const isAsrTencent = config.asrProvider === "tencent_realtime";
  const draftAsrIsVolcengine = draft.asrProvider === "volcengine";
  const draftAsrIsTencent = draft.asrProvider === "tencent_realtime";
  const isLocalHybrid = config.asrProvider === "local_hybrid";
  const asrModelPlaceholder =
    draft.asrProvider === "local_hybrid"
      ? localHybridDefaults.model
      : draft.asrProvider === "auto_optimized"
        ? autoOptimizedDefaults.model
      : draft.asrProvider === "tencent_realtime"
        ? tencentRealtimeDefaults.model
      : draft.asrProvider === "stepfun_streaming"
        ? stepfunRealtimeDefaults.model
        : "FunAudioLLM/SenseVoiceSmall";
  const asrEndpointPlaceholder =
    draft.asrProvider === "local_hybrid"
      ? localHybridDefaults.endpoint
      : draft.asrProvider === "auto_optimized"
      ? autoOptimizedDefaults.endpoint
      : draft.asrProvider === "tencent_realtime"
      ? tencentRealtimeDefaults.endpoint
      : draft.asrProvider === "stepfun_streaming"
      ? stepfunRealtimeDefaults.endpoint
      : "https://api.siliconflow.cn/v1/audio/transcriptions";

  const refreshLocalStatus = useCallback(async () => {
    try {
      setLocalStatus(await invoke<LocalAsrStatus>("local_asr_status", { config }));
    } catch {
      setLocalStatus(null);
    }
  }, [config]);

  useEffect(() => {
    if (isLocalHybrid) void refreshLocalStatus();
  }, [isLocalHybrid, refreshLocalStatus]);

  useEffect(() => {
    let disposed = false;
    const unlisten = listen<LocalAsrDownloadProgress>("local-asr-download-progress", (event) => {
      if (disposed) return;
      setLocalProgress((current) => ({ ...current, [event.payload.modelId]: event.payload }));
    });
    return () => {
      disposed = true;
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  const openLocalModelsDir = useCallback(async () => {
    setLocalBusy(true);
    try {
      const path = await invoke<string>("open_local_asr_models_dir");
      setLocalMessage(`已打开模型目录：${path}`);
      void refreshLocalStatus();
    } catch (err) {
      setLocalMessage(`打开模型目录失败：${String(err)}`);
    } finally {
      setLocalBusy(false);
    }
  }, [refreshLocalStatus]);

  const openLocalBenchmarkDir = useCallback(async () => {
    setLocalBusy(true);
    try {
      const path = await invoke<string>("open_local_asr_benchmark_dir");
      setLocalMessage(`已打开评测样本目录：${path}。放入同名 wav/txt 后可运行基线评测。`);
    } catch (err) {
      setLocalMessage(`打开评测样本目录失败：${String(err)}`);
    } finally {
      setLocalBusy(false);
    }
  }, []);

  const downloadAndActivateLocalModel = useCallback(
    async (modelId: string, mirror = "huggingface") => {
      setLocalBusy(true);
      setLocalMessage("");
      try {
        let status = await invoke<LocalAsrStatus>("download_local_asr_engine", {
          engineId: modelId,
          mirror,
        });
        setLocalStatus(status);
        status = await invoke<LocalAsrStatus>("activate_local_asr_engine", { engineId: modelId });
        setLocalStatus(status);
        await updateAndSaveConfig({
          asrProvider: "local_hybrid",
          asrModel: modelId,
          localAsrEngineId: modelId,
          asrEndpoint: "",
        });
        setLocalMessage(`${localModelLabel(modelId)} 已下载并启用。`);
        await refreshLocalStatus();
      } catch (err) {
        setLocalMessage(`本地模型下载失败：${String(err)}`);
      } finally {
        setLocalBusy(false);
      }
    },
    [refreshLocalStatus, updateAndSaveConfig],
  );

  const activateLocalModel = useCallback(
    async (modelId: string) => {
      setLocalBusy(true);
      setLocalMessage("");
      try {
        const status = await invoke<LocalAsrStatus>("activate_local_asr_engine", {
          engineId: modelId,
        });
        setLocalStatus(status);
        await updateAndSaveConfig({
          asrProvider: "local_hybrid",
          asrModel: modelId,
          localAsrEngineId: modelId,
          asrEndpoint: "",
        });
        setLocalMessage(`${localModelLabel(modelId)} 已启用。`);
        await refreshLocalStatus();
      } finally {
        setLocalBusy(false);
      }
    },
    [refreshLocalStatus, updateAndSaveConfig],
  );

  const cancelLocalDownload = useCallback(async (modelId: string) => {
    await invoke("cancel_local_asr_download", { modelId });
    setLocalMessage(`${localModelLabel(modelId)} 下载已取消，可继续断点续传。`);
    void refreshLocalStatus();
  }, [refreshLocalStatus]);

  const runLocalBenchmark = useCallback(async () => {
    setLocalBusy(true);
    try {
      const report = await invoke<LocalAsrBenchmarkResult>("run_asr_benchmark");
      setLocalMessage(`评测框架已生成：${report.summary.note}`);
      void refreshLocalStatus();
    } catch (err) {
      setLocalMessage(`本地评测失败：${String(err)}`);
    } finally {
      setLocalBusy(false);
    }
  }, [refreshLocalStatus]);

  const updateLocalMode = useCallback(
    async (mode: LocalAsrMode) => {
      await updateAndSaveConfig({ localAsrMode: mode });
      void refreshLocalStatus();
    },
    [refreshLocalStatus, updateAndSaveConfig],
  );

  const updateLiveInsert = useCallback(
    async (enabled: boolean) => {
      await updateAndSaveConfig({ liveInsertEnabled: enabled });
    },
    [updateAndSaveConfig],
  );

  const renderInlineEditor = (id: EditorId) => {
    if (editing !== id) return null;
    return (
      <div className="provider-inline-editor" onBlurCapture={handleInlineBlur}>
        {id === "asrProvider" ? (
          <SelectField
            label="ASR 服务商"
            value={draft.asrProvider}
            options={[
              { value: "auto_optimized", label: ASR_PROVIDER_LABEL.auto_optimized },
              { value: "local_hybrid", label: ASR_PROVIDER_LABEL.local_hybrid },
              { value: "tencent_realtime", label: ASR_PROVIDER_LABEL.tencent_realtime },
              { value: "stepfun_streaming", label: ASR_PROVIDER_LABEL.stepfun_streaming },
              { value: "whisper_compatible", label: ASR_PROVIDER_LABEL.whisper_compatible },
              { value: "volcengine", label: ASR_PROVIDER_LABEL.volcengine },
            ]}
            onChange={(value) => {
              const provider = value as AsrProvider;
              if (provider === "auto_optimized") {
                setDraft({
                  ...draft,
                  asrProvider: provider,
                  asrEndpoint: autoOptimizedDefaults.endpoint,
                  asrModel: autoOptimizedDefaults.model,
                  asrProviderCandidates: autoOptimizedDefaults.candidates,
                  asrAutoBenchmarkEnabled: true,
                  asrSaveBenchmarkAudio: true,
                });
                return;
              }
              if (provider === "local_hybrid") {
                setDraft({
                  ...draft,
                  asrProvider: provider,
                  asrEndpoint: localHybridDefaults.endpoint,
                  asrModel: localHybridDefaults.model,
                  localAsrEngineId: localHybridDefaults.model,
                });
                return;
              }
              if (provider === "stepfun_streaming") {
                setDraft({
                  ...draft,
                  asrProvider: provider,
                  asrEndpoint: stepfunRealtimeDefaults.endpoint,
                  asrModel: stepfunRealtimeDefaults.model,
                });
                return;
              }
              if (provider === "tencent_realtime") {
                setDraft({
                  ...draft,
                  asrProvider: provider,
                  asrEndpoint: tencentRealtimeDefaults.endpoint,
                  asrModel: tencentRealtimeDefaults.model,
                });
                return;
              }
              if (provider === "whisper_compatible") {
                setDraft({
                  ...draft,
                  asrProvider: provider,
                  asrEndpoint: whisperCompatibleDefaults.endpoint,
                  asrModel: whisperCompatibleDefaults.model,
                });
                return;
              }
              setDraft({ ...draft, asrProvider: provider });
            }}
          />
        ) : null}

        {(id === "volcengine" || (id === "asrProvider" && draftAsrIsVolcengine)) ? (
          <>
            <TextField
              label="Volcengine App ID"
              value={draft.volcengineAppId}
              onChange={(value) => setDraft({ ...draft, volcengineAppId: value })}
            />
            <TextField
              label="Volcengine Resource ID"
              value={draft.volcengineResourceId}
              onChange={(value) => setDraft({ ...draft, volcengineResourceId: value })}
            />
            <SecretField
              label="Volcengine 访问令牌"
              value={draft.volcengineAccessToken}
              hasSavedSecret={secrets.volcengineAccessToken}
              onChange={(value) => setDraft({ ...draft, volcengineAccessToken: value })}
            />
          </>
        ) : null}

        {(id === "tencent" || (id === "asrProvider" && draftAsrIsTencent)) ? (
          <>
            <TextField
              label="腾讯云 AppID"
              value={draft.tencentAppId}
              onChange={(value) => setDraft({ ...draft, tencentAppId: value })}
            />
            <TextField
              label="腾讯云 SecretID"
              value={draft.tencentSecretId}
              onChange={(value) => setDraft({ ...draft, tencentSecretId: value })}
            />
            <SecretField
              label="腾讯云 SecretKey"
              value={draft.tencentSecretKey}
              hasSavedSecret={secrets.tencentSecretKey}
              onChange={(value) => setDraft({ ...draft, tencentSecretKey: value })}
            />
          </>
        ) : null}

        {id === "asrModel" ? (
          <TextField
            label="ASR 模型"
            value={draft.asrModel}
            placeholder={asrModelPlaceholder}
            onChange={(value) => setDraft({ ...draft, asrModel: value })}
          />
        ) : null}

        {id === "asrEndpoint" ? (
          <TextField
            label="ASR 接口"
            value={draft.asrEndpoint}
            placeholder={asrEndpointPlaceholder}
            onChange={(value) => setDraft({ ...draft, asrEndpoint: value })}
          />
        ) : null}

        {id === "asrApiKey" ? (
          <SecretField
            label="ASR API Key"
            value={draft.asrApiKey}
            hasSavedSecret={secrets.asrApiKey}
            onChange={(value) => setDraft({ ...draft, asrApiKey: value })}
          />
        ) : null}

        {id === "polishProvider" ? (
          <SelectField
            label="润色服务商"
            value={draft.polishProvider}
            options={[
              { value: "openai_compatible", label: POLISH_PROVIDER_LABEL.openai_compatible },
              { value: "disabled", label: POLISH_PROVIDER_LABEL.disabled },
            ]}
            onChange={(value) => setDraft({ ...draft, polishProvider: value as PolishProvider })}
          />
        ) : null}

        {id === "polishModel" ? (
          <TextField
            label="润色模型"
            value={draft.polishModel}
            placeholder="deepseek-v4-flash"
            onChange={(value) => setDraft({ ...draft, polishModel: value })}
          />
        ) : null}

        {id === "polishEndpoint" ? (
          <TextField
            label="润色接口"
            value={draft.polishEndpoint}
            placeholder="https://api.deepseek.com/v1"
            onChange={(value) => setDraft({ ...draft, polishEndpoint: value })}
          />
        ) : null}

        {id === "polishApiKey" ? (
          <SecretField
            label="润色 API Key"
            value={draft.polishApiKey}
            hasSavedSecret={secrets.polishApiKey}
            onChange={(value) => setDraft({ ...draft, polishApiKey: value })}
          />
        ) : null}

        {id === "outputMode" ? (
          <SelectField
            label="输出模式"
            value={draft.outputMode}
            options={[
              { value: "fast_dictation", label: OUTPUT_MODE_LABEL.fast_dictation },
              { value: "smart_polish", label: OUTPUT_MODE_LABEL.smart_polish },
              { value: "prompt_builder", label: OUTPUT_MODE_LABEL.prompt_builder },
              { value: "code_prompt", label: OUTPUT_MODE_LABEL.code_prompt },
            ]}
            onChange={(value) => setDraft({ ...draft, outputMode: value as DictationMode })}
          />
        ) : null}
      </div>
    );
  };

  return (
    <>
      {showRefresh ? (
        <div className="providers-toolbar">
          <button
            type="button"
            className="ghost compact"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCcw size={14} />
            {loading ? "探测中…" : "立即探测"}
          </button>
        </div>
      ) : null}

      <div className="section-label">ASR · 语音转写</div>
      <ProviderRow
        icon={<CloudCog size={16} />}
        label="ASR 服务商"
        value={ASR_PROVIDER_LABEL[config.asrProvider] ?? config.asrProvider}
        expanded={editing === "asrProvider"}
        onClick={() => void openEditor("asrProvider")}
      />
      {renderInlineEditor("asrProvider")}
      {isAsrVolcengine ? (
        <>
          <ProviderRow
            icon={<Database size={16} />}
            label="Volcengine 凭证"
            value={config.volcengineAppId ? `App ID ${config.volcengineAppId}` : "未配置"}
            status={<HealthChip probe={asr} />}
            expanded={editing === "volcengine"}
            onClick={() => void openEditor("volcengine")}
          />
          {renderInlineEditor("volcengine")}
        </>
      ) : isAsrTencent ? (
        <>
          <ProviderRow
            icon={<Database size={16} />}
            label="腾讯云凭证"
            value={config.tencentAppId ? `AppID ${config.tencentAppId}` : "未配置"}
            status={<HealthChip probe={asr} />}
            expanded={editing === "tencent"}
            onClick={() => void openEditor("tencent")}
          />
          {renderInlineEditor("tencent")}
          <ProviderRow
            icon={<Cpu size={16} />}
            label="ASR 模型"
            value={config.asrModel || tencentRealtimeDefaults.model}
            expanded={editing === "asrModel"}
            onClick={() => void openEditor("asrModel")}
          />
          {renderInlineEditor("asrModel")}
          <ProviderRow
            icon={<Link2 size={16} />}
            label="ASR 接口"
            value={truncateUrl(config.asrEndpoint || tencentRealtimeDefaults.endpoint)}
            expanded={editing === "asrEndpoint"}
            onClick={() => void openEditor("asrEndpoint")}
          />
          {renderInlineEditor("asrEndpoint")}
        </>
      ) : (
        <>
          {isLocalHybrid ? (
            <LocalAsrCard
              busy={localBusy}
              message={localMessage}
              progress={localProgress}
              status={localStatus}
              onRefresh={refreshLocalStatus}
              onOpenDir={openLocalModelsDir}
              onOpenBenchmarkDir={openLocalBenchmarkDir}
              onDownload={downloadAndActivateLocalModel}
              onActivate={activateLocalModel}
              onCancel={cancelLocalDownload}
              onBenchmark={runLocalBenchmark}
              mode={config.localAsrMode}
              liveInsertEnabled={config.liveInsertEnabled}
              autoInsertEnabled={config.autoInsert}
              onModeChange={updateLocalMode}
              onLiveInsertChange={updateLiveInsert}
            />
          ) : (
            <>
              <ProviderRow
                icon={<Cpu size={16} />}
                label="ASR 模型"
                value={config.asrModel || "未配置"}
                expanded={editing === "asrModel"}
                onClick={() => void openEditor("asrModel")}
              />
              {renderInlineEditor("asrModel")}
              <ProviderRow
                icon={<Link2 size={16} />}
                label="ASR 接口"
                value={truncateUrl(config.asrEndpoint)}
                status={<HealthChip probe={asr} />}
                expanded={editing === "asrEndpoint"}
                onClick={() => void openEditor("asrEndpoint")}
              />
              {renderInlineEditor("asrEndpoint")}
              <ProviderRow
                icon={<Key size={16} />}
                label="ASR API Key"
                value={secrets.asrApiKey ? "已保存" : "未配置"}
                status={
                  secrets.asrApiKey ? <span className="status-chip saved">已保存</span> : null
                }
                expanded={editing === "asrApiKey"}
                onClick={() => void openEditor("asrApiKey")}
              />
              {renderInlineEditor("asrApiKey")}
            </>
          )}
        </>
      )}

      <div className="section-label">润色 · LLM</div>
      <ProviderRow
        icon={<CloudCog size={16} />}
        label="润色服务商"
        value={POLISH_PROVIDER_LABEL[config.polishProvider] ?? config.polishProvider}
        expanded={editing === "polishProvider"}
        onClick={() => void openEditor("polishProvider")}
      />
      {renderInlineEditor("polishProvider")}
      {config.polishProvider !== "disabled" ? (
        <>
          <ProviderRow
            icon={<Cpu size={16} />}
            label="润色模型"
            value={config.polishModel || "未配置"}
            expanded={editing === "polishModel"}
            onClick={() => void openEditor("polishModel")}
          />
          {renderInlineEditor("polishModel")}
          <ProviderRow
            icon={<Link2 size={16} />}
            label="润色接口"
            value={truncateUrl(config.polishEndpoint)}
            status={<HealthChip probe={polish} />}
            expanded={editing === "polishEndpoint"}
            onClick={() => void openEditor("polishEndpoint")}
          />
          {renderInlineEditor("polishEndpoint")}
          <ProviderRow
            icon={<Key size={16} />}
            label="润色 API Key"
            value={secrets.polishApiKey ? "已保存" : "未配置"}
            status={
              secrets.polishApiKey ? <span className="status-chip saved">已保存</span> : null
            }
            expanded={editing === "polishApiKey"}
            onClick={() => void openEditor("polishApiKey")}
          />
          {renderInlineEditor("polishApiKey")}
        </>
      ) : null}

      <div className="section-label">输出</div>
      <ProviderRow
        icon={<AudioLines size={16} />}
        label="输出模式"
        value={OUTPUT_MODE_LABEL[config.outputMode] ?? config.outputMode}
        expanded={editing === "outputMode"}
        onClick={() => void openEditor("outputMode")}
      />
      {renderInlineEditor("outputMode")}
      {showAutoInsertRow ? (
        <div className="provider-row is-static provider-row--inline">
          <span className="provider-row__icon">
            <Wrench size={16} />
          </span>
          <div className="provider-row__main">
            <span className="provider-row__label">自动粘贴到当前光标</span>
            <span className="provider-row__value">
              {config.autoInsert ? "开启 — 文本自动粘贴" : "关闭 — 文本仅复制到剪贴板"}
            </span>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={config.autoInsert}
              onChange={(event) => {
                const next = { ...config, autoInsert: event.target.checked };
                setConfig(next);
                void updateAndSaveConfig({ autoInsert: event.target.checked });
              }}
            />
            <span />
          </label>
        </div>
      ) : null}
    </>
  );
}

function LocalAsrCard({
  status,
  progress,
  busy,
  message,
  mode,
  liveInsertEnabled,
  autoInsertEnabled,
  onRefresh,
  onOpenDir,
  onOpenBenchmarkDir,
  onDownload,
  onActivate,
  onCancel,
  onBenchmark,
  onModeChange,
  onLiveInsertChange,
}: {
  status: LocalAsrStatus | null;
  progress: Record<string, LocalAsrDownloadProgress>;
  busy: boolean;
  message: string;
  mode: LocalAsrMode;
  liveInsertEnabled: boolean;
  autoInsertEnabled: boolean;
  onRefresh: () => void | Promise<void>;
  onOpenDir: () => void | Promise<void>;
  onOpenBenchmarkDir: () => void | Promise<void>;
  onDownload: (modelId: string, mirror?: string) => void | Promise<void>;
  onActivate: (modelId: string) => void | Promise<void>;
  onCancel: (modelId: string) => void | Promise<void>;
  onBenchmark: () => void | Promise<void>;
  onModeChange: (mode: LocalAsrMode) => void | Promise<void>;
  onLiveInsertChange: (enabled: boolean) => void | Promise<void>;
}) {
  const models = normalizeLocalModels(status?.models ?? []);
  const activeEngine = status?.engines.find((engine) => engine.isActive);
  const recommendedEngine = status?.engines.find((engine) => engine.id === status?.recommendedEngineId);
  const isLocalActive = Boolean(status?.installed && status?.activeEngineId);

  return (
    <div className="provider-local-asr-card">
      <div className="provider-local-asr-card__header">
        <div>
          <strong>本地模型</strong>
        <small>Sherpa-ONNX 本地运行，不需要用户手动配置 endpoint 或启动 runtime。</small>
        </div>
        <span className={isLocalActive ? "status-chip saved" : "status-chip"}>
          {isLocalActive ? "已启用" : status?.runtimeInstalled ? "Runtime 就绪" : "未下载"}
        </span>
      </div>

      <div className="local-asr-control-grid">
        <SelectField
          label="本地策略"
          value={mode}
          options={[
            { value: "auto", label: "自动择优" },
            { value: "fast", label: "平衡极速" },
            { value: "zh_fast", label: "中文极速" },
            { value: "accurate", label: "准确率优先" },
          ]}
          onChange={(value) => void onModeChange(value as LocalAsrMode)}
        />
        <label className="local-asr-toggle-row">
          <span>
            <strong>边说边插入</strong>
            <small>
              {autoInsertEnabled
                ? "实验功能：支持的输入框会 stable 插入，final 原地替换。"
                : "需要先开启自动粘贴。"}
            </small>
          </span>
          <span className="switch">
            <input
              type="checkbox"
              checked={liveInsertEnabled && autoInsertEnabled}
              disabled={!autoInsertEnabled}
              onChange={(event) => void onLiveInsertChange(event.target.checked)}
            />
            <span />
          </span>
        </label>
      </div>

      <div className="local-engine-summary">
        <span>当前：{activeEngine?.displayName ?? localModelLabel(status?.activeEngineId ?? "")}</span>
        <span>推荐：{recommendedEngine?.displayName ?? localModelLabel(status?.recommendedEngineId ?? "")}</span>
        {status?.benchmarkSummary ? (
          <span>Benchmark：{status.benchmarkSummary.note}</span>
        ) : null}
      </div>

      <div className="local-model-list">
        {models.map((model) => {
          const eventProgress = progress[model.id];
          const phase = eventProgress?.phase || "idle";
          const percent =
            eventProgress && eventProgress.bytesTotal > 0
              ? Math.round((eventProgress.bytesDownloaded / eventProgress.bytesTotal) * 100)
              : model.totalBytes && model.totalBytes > 0
                ? Math.round((model.downloadBytes / model.totalBytes) * 100)
                : 0;
          const downloading =
            phase === "downloading-model" ||
            phase === "downloading-runtime" ||
            phase === "extracting-runtime" ||
            phase === "started" ||
            phase === "progress" ||
            phase === "installing-runtime";
          const label = localModelBadge(model.id);
          const primary = model.id === "sensevoice-small";

          return (
            <div key={model.id} className={model.isActive ? "local-model-card is-active" : "local-model-card"}>
              <div className="local-model-card__main">
                <span className="local-model-card__eyebrow">{label}</span>
                <strong>{model.displayName || localModelLabel(model.id)}</strong>
                <small>
                  {model.isActive
                    ? "已启用，后续录音默认走本地识别。"
                    : model.isDownloaded
                      ? "已下载，可直接启用。"
                      : primary
                        ? "推荐默认下载，小巧、启动快，适合中文、英文和中英混输。"
                        : model.id === "funasr-paraformer-zh-small"
                          ? "中文短句更快，英文能力弱于 SenseVoice。"
                          : "更强上下文，体积更大，适合长句和复杂术语。"}
                </small>
                {downloading ? (
                  <div className="local-model-progress" aria-label={`${percent}%`}>
                    <span style={{ width: `${Math.max(1, Math.min(percent, 100))}%` }} />
                  </div>
                ) : null}
                <small className="local-model-card__meta">
                  {downloading
                    ? phase === "installing-runtime"
                      || phase === "downloading-runtime"
                      || phase === "extracting-runtime"
                      ? "正在安装本地识别引擎"
                      : `下载中 ${percent}%`
                    : model.totalBytes && model.totalBytes > 0
                      ? `${formatBytes(model.downloadBytes)} / ${formatBytes(model.totalBytes)}`
                      : model.isDownloaded
                        ? "模型文件已就绪"
                        : "等待下载"}
                </small>
              </div>
              <div className="local-model-card__actions">
                {downloading ? (
                  <button
                    type="button"
                    className="ghost compact"
                    disabled={busy}
                    onClick={() => void onCancel(model.id)}
                  >
                    取消下载
                  </button>
                ) : model.isDownloaded ? (
                  <button
                    type="button"
                    className="ghost compact"
                    disabled={busy || model.isActive}
                    onClick={() => void onActivate(model.id)}
                  >
                    {model.isActive ? "已启用" : "启用"}
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className={primary ? "primary compact" : "ghost compact"}
                      disabled={busy}
                      onClick={() => void onDownload(model.id, "huggingface")}
                    >
                      {primary
                        ? "下载并启用"
                        : model.id === "funasr-paraformer-zh-small"
                          ? "下载中文极速模型"
                          : "下载高准确率模型"}
                    </button>
                    <button
                      type="button"
                      className="ghost compact"
                      disabled={busy}
                      onClick={() => void onDownload(model.id, "hf-mirror")}
                    >
                      镜像下载
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="provider-runtime-card__actions">
        <button type="button" className="ghost compact" disabled={busy} onClick={() => void onRefresh()}>
          <RefreshCcw size={14} />
          重新检查
        </button>
        <button type="button" className="ghost compact" disabled={busy} onClick={() => void onOpenDir()}>
          <FolderOpen size={14} />
          打开模型目录
        </button>
        <button type="button" className="ghost compact" disabled={busy} onClick={() => void onBenchmark()}>
          <AudioLines size={14} />
          运行基线评测
        </button>
        <button
          type="button"
          className="ghost compact"
          disabled={busy}
          onClick={() => void onOpenBenchmarkDir()}
        >
          <FolderOpen size={14} />
          打开评测目录
        </button>
      </div>

      {message ? (
        <p className="provider-local-asr-card__message">{message}</p>
      ) : null}
    </div>
  );
}

function normalizeLocalModels(models: LocalAsrModelStatus[]): LocalAsrModelStatus[] {
  const fallback: LocalAsrModelStatus[] = [
    {
      id: "sensevoice-small",
      displayName: "SenseVoice Small int8",
      family: "sherpa_onnx_sensevoice",
      sizeLabel: "约 350 MB",
      downloadBytes: 0,
      totalBytes: null,
      isDownloaded: false,
      isActive: false,
      path: "",
      source: "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17",
    },
    {
      id: "funasr-paraformer-zh-small",
      displayName: "FunASR Paraformer 中文小模型",
      family: "sherpa_onnx_funasr",
      sizeLabel: "约 220 MB",
      downloadBytes: 0,
      totalBytes: null,
      isDownloaded: false,
      isActive: false,
      path: "",
      source: "csukuangfj/sherpa-onnx-paraformer-zh-small-2024-03-09",
    },
    {
      id: "qwen3-asr-0.6b",
      displayName: "Qwen3-ASR 0.6B int8",
      family: "sherpa_onnx_qwen",
      sizeLabel: "约 1.2 GB",
      downloadBytes: 0,
      totalBytes: null,
      isDownloaded: false,
      isActive: false,
      path: "",
      source: "ModelScope: zengshuishui/Qwen3-ASR-onnx + Qwen/Qwen3-ASR-0.6B",
    },
  ];
  return fallback.map((item) => models.find((model) => model.id === item.id) ?? item);
}

function localModelLabel(modelId: string): string {
  if (modelId === "sensevoice-small") return "SenseVoice Small";
  if (modelId === "funasr-paraformer-zh-small") return "FunASR 中文极速";
  if (modelId === "qwen3-asr-0.6b") return "Qwen3-ASR 0.6B";
  return modelId || "SenseVoice Small";
}

function localModelBadge(modelId: string): string {
  if (modelId === "sensevoice-small") return "默认极速模型";
  if (modelId === "funasr-paraformer-zh-small") return "中文极速模型";
  if (modelId === "qwen3-asr-0.6b") return "高准确率模型";
  return "本地模型";
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function TextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="drawer-field">
      <span>{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="drawer-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function diffPatch(current: AppConfig, draft: AppConfig): Partial<AppConfig> {
  const patch: Partial<AppConfig> = {};
  (Object.keys(draft) as Array<keyof AppConfig>).forEach((key) => {
    if (current[key] !== draft[key]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (patch as any)[key] = draft[key];
    }
  });
  return patch;
}

function truncateUrl(url: string): string {
  if (!url) return "未配置";
  if (url.length <= 36) return url;
  return `${url.slice(0, 22)}…${url.slice(-10)}`;
}
