import { invoke } from "@tauri-apps/api/core";
import type { AppConfig } from "../appTypes.js";

export type ProbeStatus = "healthy" | "degraded" | "down" | "unknown" | "unconfigured";

export interface ProbeResult {
  status: ProbeStatus;
  latencyMs: number | null;
  message: string | null;
  checkedAt: number;
}

export interface SecretStatus {
  asrApiKey: boolean;
  polishApiKey: boolean;
  volcengineAccessToken: boolean;
}

export async function probeAsr(config: AppConfig): Promise<ProbeResult> {
  const raw = await invoke<{
    status: ProbeStatus;
    latencyMs: number | null;
    message: string | null;
    checkedAt: number;
  }>("probe_asr_endpoint", { config });
  return raw;
}

export async function probePolish(config: AppConfig): Promise<ProbeResult> {
  const raw = await invoke<{
    status: ProbeStatus;
    latencyMs: number | null;
    message: string | null;
    checkedAt: number;
  }>("probe_polish_endpoint", { config });
  return raw;
}

export async function fetchSecretStatus(): Promise<SecretStatus> {
  return invoke<SecretStatus>("check_secret_status");
}
