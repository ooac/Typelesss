import type { DictationMode } from "./types.js";

export type RuntimeState = "idle" | "recording" | "processing" | "inserted" | "error";
export type CapsuleSize = "large" | "medium" | "small";
export type AsrProvider = "whisper_compatible" | "volcengine" | "stepfun_streaming" | "local_hybrid";
export type PolishProvider = "openai_compatible" | "disabled";

export interface Preset {
  id: string;
  label: string;
  hotkey: string;
  outputMode: DictationMode;
}

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
  capsuleSize: CapsuleSize;
  autoInsert: boolean;
  hotkey: string;
  presets: Preset[];
  activePresetId: string;
}

export type PermissionState = "granted" | "denied" | "unknown";

export interface PermissionStatus {
  microphone: PermissionState;
  inputMonitoring: PermissionState;
  accessibility: PermissionState;
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
  capsuleSize: CapsuleSize;
}

export interface LocalAsrStatus {
  installed: boolean;
  runtimeReachable: boolean;
  modelRoot: string;
  streamingModelInstalled: boolean;
  finalModelInstalled: boolean;
  endpoint: string;
  runtimeBinary: string;
  runtimeBinaryFound: boolean;
  message: string;
  models: LocalAsrModelStatus[];
  activeModelId: string;
  downloadProgress: number;
  downloadPhase: string;
  isActive: boolean;
}

export interface LocalAsrModelStatus {
  id: string;
  displayName: string;
  hfRepo: string;
  downloadedBytes: number;
  totalBytes: number;
  isDownloaded: boolean;
  isActive: boolean;
  downloadPhase: string;
  downloadProgress: number;
}

export interface LocalAsrDownloadProgress {
  modelId: string;
  file: string;
  fileIndex: number;
  fileCount: number;
  bytesDownloaded: number;
  bytesTotal: number;
  phase: string;
  error?: string | null;
}
