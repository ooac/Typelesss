import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useApp } from "../state/AppContext.js";
import {
  fetchSecretStatus,
  probeAsr,
  probePolish,
  type ProbeResult,
  type SecretStatus,
} from "./probe.js";

interface HealthContextValue {
  asr: ProbeResult | null;
  polish: ProbeResult | null;
  secrets: SecretStatus;
  refresh: () => Promise<void>;
  loading: boolean;
}

const HealthCtx = createContext<HealthContextValue | null>(null);

const DEFAULT_SECRETS: SecretStatus = {
  asrApiKey: false,
  polishApiKey: false,
  volcengineAccessToken: false,
};

const POLL_INTERVAL_MS = 30_000;

export function useHealth(): HealthContextValue {
  const value = useContext(HealthCtx);
  if (!value) throw new Error("useHealth must be inside <HealthProvider>");
  return value;
}

export function HealthProvider({ children }: { children: ReactNode }) {
  const { config, isTauriRuntime } = useApp();
  const [asr, setAsr] = useState<ProbeResult | null>(null);
  const [polish, setPolish] = useState<ProbeResult | null>(null);
  const [secrets, setSecrets] = useState<SecretStatus>(DEFAULT_SECRETS);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    if (!isTauriRuntime) return;
    setLoading(true);
    try {
      const [asrResult, polishResult, secretResult] = await Promise.all([
        probeAsr(config).catch(
          (err): ProbeResult => ({
            status: "down",
            latencyMs: null,
            message: String(err),
            checkedAt: Date.now(),
          }),
        ),
        probePolish(config).catch(
          (err): ProbeResult => ({
            status: "down",
            latencyMs: null,
            message: String(err),
            checkedAt: Date.now(),
          }),
        ),
        fetchSecretStatus().catch(() => DEFAULT_SECRETS),
      ]);
      setAsr(asrResult);
      setPolish(polishResult);
      setSecrets(secretResult);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isTauriRuntime) return undefined;
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
    // re-poll when relevant config fields change (provider/endpoint/keys)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isTauriRuntime,
    config.asrProvider,
    config.asrEndpoint,
    config.asrApiKey,
    config.polishProvider,
    config.polishEndpoint,
    config.polishApiKey,
    config.volcengineAppId,
    config.volcengineResourceId,
    config.volcengineAccessToken,
  ]);

  return (
    <HealthCtx.Provider value={{ asr, polish, secrets, refresh, loading }}>
      {children}
    </HealthCtx.Provider>
  );
}
