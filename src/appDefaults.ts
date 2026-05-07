import type { AppConfig } from "./appTypes.js";

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
};

export const fallbackHotkey = "Control+Option+Space";
