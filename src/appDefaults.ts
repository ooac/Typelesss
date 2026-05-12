import type { AppConfig, Preset } from "./appTypes.js";

export const stepfunRealtimeDefaults = {
  endpoint: "wss://api.stepfun.com/v1/realtime/asr/stream",
  model: "step-asr-1.1-stream",
};

export const autoOptimizedDefaults = {
  endpoint: "wss://dashscope.aliyuncs.com/api-ws/v1/inference/",
  model: "paraformer-realtime-v2",
  candidates: ["alibaba_paraformer_realtime", "volcengine", "local_hybrid", "whisper_compatible"],
};

export const localHybridDefaults = {
  endpoint: "",
  model: "sensevoice-small",
};

export const whisperCompatibleDefaults = {
  endpoint: "https://api.siliconflow.cn/v1/audio/transcriptions",
  model: "FunAudioLLM/SenseVoiceSmall",
};

const DEFAULT_PRESET: Preset = {
  id: "default",
  label: "默认",
  hotkey: "Option+Space",
  outputMode: "smart_polish",
};

export const defaultConfig: AppConfig = {
  asrProvider: "auto_optimized",
  asrEndpoint: autoOptimizedDefaults.endpoint,
  asrApiKey: "",
  asrModel: autoOptimizedDefaults.model,
  asrProviderCandidates: autoOptimizedDefaults.candidates,
  asrAutoBenchmarkEnabled: true,
  asrSaveBenchmarkAudio: true,
  volcengineAppId: "",
  volcengineAccessToken: "",
  volcengineResourceId: "",
  polishProvider: "openai_compatible",
  polishEndpoint: "https://api.deepseek.com/v1",
  polishApiKey: "",
  polishModel: "deepseek-v4-flash",
  outputMode: "smart_polish",
  localAsrMode: "auto",
  localAsrEngineId: localHybridDefaults.model,
  liveInsertEnabled: false,
  capsuleSize: "large",
  autoInsert: true,
  hotkey: "Option+Space",
  presets: [DEFAULT_PRESET],
  activePresetId: DEFAULT_PRESET.id,
};

function clonePresets(presets: Preset[]): Preset[] {
  return presets.map((preset) => ({ ...preset }));
}

export function mergeLoadedConfig(loaded: Partial<AppConfig>): AppConfig {
  const loadedPresets = Array.isArray(loaded.presets) ? loaded.presets : [];
  const hasStoredPresets = loadedPresets.length > 0;
  const legacyHotkey = loaded.hotkey?.trim() || defaultConfig.hotkey;
  const legacyOutputMode = loaded.outputMode ?? defaultConfig.outputMode;
  const presets = hasStoredPresets
    ? clonePresets(loadedPresets)
    : [{ ...DEFAULT_PRESET, hotkey: legacyHotkey, outputMode: legacyOutputMode }];

  const activePresetId =
    loaded.activePresetId && presets.some((preset) => preset.id === loaded.activePresetId)
      ? loaded.activePresetId
      : presets[0]?.id ?? DEFAULT_PRESET.id;
  const activePreset = presets.find((preset) => preset.id === activePresetId) ?? presets[0];

  return {
    ...defaultConfig,
    ...loaded,
    presets,
    activePresetId,
    hotkey: activePreset?.hotkey ?? legacyHotkey,
    outputMode: activePreset?.outputMode ?? legacyOutputMode,
  };
}

export function normalizeAsrProviderConfig(config: AppConfig): AppConfig {
  const isLocalModelId = (model: string): boolean => {
    const normalized = model.trim().toLowerCase();
    return (
      normalized === "sensevoice-small" ||
      normalized === "funasr-paraformer-zh-small" ||
      normalized === "qwen3-asr-0.6b" ||
      normalized === "qwen3-asr-1.7b"
    );
  };

  if (config.asrProvider === "whisper_compatible") {
    const modelLooksLocal = isLocalModelId(config.asrModel);
    const modelLooksRealtime = config.asrModel.trim().toLowerCase().startsWith("step-asr");
    if (!config.asrEndpoint.trim() || !config.asrModel.trim() || modelLooksLocal || modelLooksRealtime) {
      return {
        ...config,
        asrEndpoint: config.asrEndpoint.trim() || whisperCompatibleDefaults.endpoint,
        asrModel: modelLooksLocal || modelLooksRealtime || !config.asrModel.trim()
          ? whisperCompatibleDefaults.model
          : config.asrModel,
      };
    }
  }
  if (config.asrProvider === "auto_optimized") {
    return {
      ...config,
      asrEndpoint: config.asrEndpoint.trim() || autoOptimizedDefaults.endpoint,
      asrModel: config.asrModel.trim() || autoOptimizedDefaults.model,
      asrProviderCandidates:
        config.asrProviderCandidates?.length > 0
          ? config.asrProviderCandidates
          : autoOptimizedDefaults.candidates,
      asrAutoBenchmarkEnabled: config.asrAutoBenchmarkEnabled ?? true,
      asrSaveBenchmarkAudio: config.asrSaveBenchmarkAudio ?? true,
    };
  }
  if (config.asrProvider === "local_hybrid") {
    const configuredEngine =
      (isLocalModelId(config.localAsrEngineId) && config.localAsrEngineId !== "qwen3-asr-1.7b"
        ? config.localAsrEngineId.trim()
        : "") ||
      (isLocalModelId(config.asrModel) && config.asrModel !== "qwen3-asr-1.7b"
        ? config.asrModel.trim()
        : localHybridDefaults.model);
    return {
      ...config,
      asrEndpoint: localHybridDefaults.endpoint,
      asrModel: configuredEngine,
      localAsrEngineId: configuredEngine,
      localAsrMode: config.localAsrMode || "auto",
    };
  }
  if (config.asrProvider === "stepfun_streaming") {
    return {
      ...config,
      asrEndpoint: config.asrEndpoint.trim() || stepfunRealtimeDefaults.endpoint,
      asrModel: config.asrModel.trim() || stepfunRealtimeDefaults.model,
    };
  }
  return config;
}

export function makePresetId(): string {
  return `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
