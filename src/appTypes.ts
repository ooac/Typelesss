import type { DictationMode } from "./types.js";

export type RuntimeState = "idle" | "recording" | "processing" | "inserted" | "error";
export type AsrProvider = "whisper_compatible" | "volcengine";
export type PolishProvider = "openai_compatible" | "disabled";

export interface AppConfig {
  asrProvider: AsrProvider;
  asrEndpoint: string;
  asrApiKey: string;
  asrModel: string;
  volcengineAppId: string;
  volcengineAccessToken: string;
  volcengineResourceId: string;
  polishProvider: PolishProvider;
  polishEndpoint: string;
  polishApiKey: string;
  polishModel: string;
  outputMode: DictationMode;
  autoInsert: boolean;
  hotkey: string;
}

export interface RecordingResult {
  wavPath: string;
  durationMs: number;
  sampleRate: number;
  samples: number;
}

export interface CapsulePayload {
  state: RuntimeState;
  status: string;
  previewText: string;
  startedAt: number | null;
}
