import type { AppConfig, Preset } from "./appTypes.js";

export const stepfunRealtimeDefaults = {
  endpoint: "wss://api.stepfun.com/v1/realtime/asr/stream",
  model: "step-asr-1.1-stream",
};

export const localHybridDefaults = {
  endpoint: "",
  model: "qwen3-asr-0.6b",
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
  asrProvider: "whisper_compatible",
  asrEndpoint: whisperCompatibleDefaults.endpoint,
  asrApiKey: "",
  asrModel: whisperCompatibleDefaults.model,
  volcengineAppId: "",
  volcengineAccessToken: "",
  volcengineResourceId: "",
  polishProvider: "openai_compatible",
  polishEndpoint: "https://api.deepseek.com/v1",
  polishApiKey: "",
  polishModel: "deepseek-v4-flash",
  outputMode: "smart_polish",
  capsuleSize: "large",
  autoInsert: true,
  hotkey: "Option+Space",
  presets: [DEFAULT_PRESET],
  activePresetId: DEFAULT_PRESET.id,
};

export function normalizeAsrProviderConfig(config: AppConfig): AppConfig {
  if (config.asrProvider === "whisper_compatible") {
    const modelLooksLocal = config.asrModel.trim().toLowerCase().startsWith("qwen3-asr");
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
  if (config.asrProvider === "local_hybrid") {
    return {
      ...config,
      asrEndpoint: localHybridDefaults.endpoint,
      asrModel: config.asrModel.trim() || localHybridDefaults.model,
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

export const fallbackHotkey = "Control+Option+Space";

export function makePresetId(): string {
  return `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
