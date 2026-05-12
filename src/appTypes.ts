import type { DictationMode } from "./types.js";

export type RuntimeState = "idle" | "recording" | "processing" | "inserted" | "error";
export type CapsuleSize = "large" | "medium" | "small";
export type AsrProvider =
  | "auto_optimized"
  | "whisper_compatible"
  | "volcengine"
  | "stepfun_streaming"
  | "local_hybrid";
export type PolishProvider = "openai_compatible" | "disabled";
export type LocalAsrMode = "auto" | "fast" | "zh_fast" | "accurate";

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
  asrProviderCandidates: string[];
  asrAutoBenchmarkEnabled: boolean;
  asrSaveBenchmarkAudio: boolean;
  volcengineAppId: string;
  volcengineAccessToken: string;
  volcengineResourceId: string;
  polishProvider: PolishProvider;
  polishEndpoint: string;
  polishApiKey: string;
  polishModel: string;
  outputMode: DictationMode;
  localAsrMode: LocalAsrMode;
  localAsrEngineId: string;
  liveInsertEnabled: boolean;
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
  runtimeInstalled: boolean;
  modelInstalled: boolean;
  installDir: string;
  runtimeBinary: string | null;
  models: LocalAsrModelStatus[];
  engines: LocalAsrEngineStatus[];
  activeModelId: string;
  activeEngineId: string;
  recommendedEngineId: string;
  benchmarkSummary: LocalAsrBenchmarkSummary | null;
  downloadProgress: number | null;
  downloadPhase: string | null;
}

export interface LocalAsrEngineStatus {
  id: string;
  displayName: string;
  family: "sherpa_onnx" | "qwen" | "whisper_cpp" | "apple_speech";
  profile: "fast" | "zh_fast" | "accurate" | "future";
  isDownloaded: boolean;
  isActive: boolean;
  supportsStreaming: boolean;
  supportsPrompt: boolean;
  latencyHintMs: number | null;
  accuracyHint: string;
}

export interface LocalAsrBenchmarkSummary {
  lastRunAt: string | null;
  bestEngineId: string | null;
  p50FirstPartialMs: number | null;
  p95FinalMs: number | null;
  technicalTermRecall: number | null;
  note: string;
}

export interface LocalAsrBenchmarkResult {
  runId: string;
  engineId: string;
  samples: LocalAsrBenchmarkSampleResult[];
  summary: LocalAsrBenchmarkSummary;
  outputPath: string;
}

export interface LocalAsrBenchmarkSampleResult {
  id: string;
  category: string;
  expected: string;
  actual: string;
  finalLatencyMs: number;
  technicalTermHits: number;
  technicalTermTotal: number;
  success: boolean;
  error: string | null;
}

export interface LocalAsrModelStatus {
  id: string;
  displayName: string;
  family: string;
  sizeLabel: string;
  downloadBytes: number;
  totalBytes: number | null;
  isDownloaded: boolean;
  isActive: boolean;
  path: string;
  source: string;
}

export interface LocalAsrDownloadProgress {
  modelId: string;
  bytesDownloaded: number;
  bytesTotal: number;
  progress: number;
  phase: string;
  message: string;
}
