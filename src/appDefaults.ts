import type { AppConfig, Preset } from "./appTypes.js";

const DEFAULT_PRESET: Preset = {
  id: "default",
  label: "默认",
  hotkey: "Option+Space",
  outputMode: "smart_polish",
};

export const defaultConfig: AppConfig = {
  asrProvider: "whisper_compatible",
  asrEndpoint: "https://api.siliconflow.cn/v1/audio/transcriptions",
  asrApiKey: "",
  asrModel: "FunAudioLLM/SenseVoiceSmall",
  volcengineAppId: "",
  volcengineAccessToken: "",
  volcengineResourceId: "",
  polishProvider: "openai_compatible",
  polishEndpoint: "https://api.deepseek.com/v1",
  polishApiKey: "",
  polishModel: "deepseek-v4-flash",
  outputMode: "smart_polish",
  autoInsert: true,
  hotkey: "Option+Space",
  presets: [DEFAULT_PRESET],
  activePresetId: DEFAULT_PRESET.id,
};

export const fallbackHotkey = "Control+Option+Space";

export function makePresetId(): string {
  return `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
