import type { AppConfig } from "../appTypes.js";

const REALTIME_ASR_PROVIDER_IDS = new Set<AppConfig["asrProvider"]>([
  "auto_optimized",
  "tencent_realtime",
  "stepfun_streaming",
]);

export function isRealtimeAsrProvider(provider: AppConfig["asrProvider"]): boolean {
  return REALTIME_ASR_PROVIDER_IDS.has(provider);
}

export function latestRealtimeText(realtimeFinal: string, realtimePreview: string): string {
  return realtimeFinal.trim() || realtimePreview.trim();
}
