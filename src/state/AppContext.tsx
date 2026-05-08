import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { defaultConfig, fallbackHotkey } from "../appDefaults.js";
import type {
  AppConfig,
  CapsulePayload,
  Preset,
  RecordingResult,
  RuntimeState,
} from "../appTypes.js";
import { insertSession } from "../db/historyRepo.js";
import { formatHotkey } from "../hotkey.js";
import { normalizeFast, validatePolishOutput } from "../index.js";
import type { DictationMode } from "../types.js";

interface AppContextValue {
  config: AppConfig;
  setConfig: (config: AppConfig) => void;
  state: RuntimeState;
  status: string;
  rawText: string;
  normalizedText: string;
  finalText: string;
  error: string;
  /**
   * Bumps every time a session is persisted, so views like HistoryPage can
   * react and re-query the DB without us pulling history into context state.
   */
  historyRevision: number;
  recordingStartedAt: number | null;
  recordingElapsed: string;
  capsuleText: string;
  formattedHotkey: string;
  isTauriRuntime: boolean;
  shouldShowInputMonitoringAction: boolean;
  shouldShowAccessibilityAction: boolean;
  activePreset: Preset | null;
  saveConfig: () => Promise<void>;
  updateAndSaveConfig: (patch: Partial<AppConfig>) => Promise<void>;
  openInputMonitoringSettings: () => Promise<void>;
  openAccessibilitySettings: () => Promise<void>;
  installToApplicationsAndOpenPermission: () => Promise<void>;
  startRecording: () => Promise<void>;
  stopAndProcess: () => Promise<void>;
  cancelRecording: () => Promise<void>;
  clearTranscript: () => void;
  setIsHotkeyCapture: (capturing: boolean) => void;
}

interface ShortcutTogglePayload {
  shortcut?: string;
}

const AppCtx = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppCtx);
  if (!value) throw new Error("useApp must be inside <AppProvider>");
  return value;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const isTauriRuntime = "__TAURI_INTERNALS__" in window;
  const [config, setConfigState] = useState<AppConfig>(defaultConfig);
  const [state, setState] = useState<RuntimeState>("idle");
  const [status, setStatus] = useState("准备就绪");
  const [rawText, setRawText] = useState("");
  const [normalizedText, setNormalizedText] = useState("");
  const [finalText, setFinalText] = useState("");
  const [error, setError] = useState("");
  const [historyRevision, setHistoryRevision] = useState(0);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const stateRef = useRef<RuntimeState>("idle");
  const configRef = useRef<AppConfig>(defaultConfig);
  const isHotkeyCaptureRef = useRef(false);
  /**
   * Tracks which preset is driving the *current* recording session so that
   * `stopAndProcess` uses its outputMode even if the user changes the active
   * preset between trigger and stop.
   */
  const sessionPresetIdRef = useRef<string>(defaultConfig.activePresetId);

  const setConfig = useCallback((next: AppConfig) => {
    configRef.current = next;
    setConfigState(next);
  }, []);

  const setRuntimeState = useCallback((next: RuntimeState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const setIsHotkeyCapture = useCallback((capturing: boolean) => {
    isHotkeyCaptureRef.current = capturing;
  }, []);

  const findPresetByShortcut = useCallback((shortcut: string | undefined): Preset | null => {
    const presets = configRef.current.presets;
    if (!presets || presets.length === 0) return null;
    const normalize = (hk: string) => hk.replace(/\s+/g, "").toLowerCase();
    if (shortcut) {
      const target = normalize(shortcut);
      const match = presets.find((p) => normalize(p.hotkey) === target);
      if (match) return match;
    }
    // Fallback: active preset, or first preset
    return (
      presets.find((p) => p.id === configRef.current.activePresetId) ?? presets[0] ?? null
    );
  }, []);

  // load_config + Right Option migration
  useEffect(() => {
    if (!isTauriRuntime) {
      setStatus("浏览器预览模式：原生录音和系统授权需在 Typelesss App 内使用。");
      return;
    }
    invoke<AppConfig>("load_config")
      .then((loaded) => {
        const loadedConfig = { ...defaultConfig, ...loaded };
        setConfig(loadedConfig);
        sessionPresetIdRef.current = loadedConfig.activePresetId || loadedConfig.presets[0]?.id || "default";
        if (loadedConfig.hotkey === "RightOption") {
          return invoke<string>("save_config", { config: loadedConfig })
            .then(() => setStatus("Right Option 已保存。若你刚打开输入监控权限，请重启 App 后再按右 Option。"))
            .catch(async (err) => {
              const fallbackConfig = { ...loadedConfig, hotkey: fallbackHotkey };
              try {
                const registeredHotkey = await invoke<string>("save_config", { config: fallbackConfig });
                setConfig({ ...fallbackConfig, hotkey: registeredHotkey });
                setError(`Right Option 未启用：${String(err)}`);
                setStatus(
                  `已临时启用 ${formatHotkey(registeredHotkey)}。完成输入监控授权后可再改回 Right Option。`,
                );
              } catch (fallbackErr) {
                setError(`${String(err)}；备用快捷键也注册失败：${String(fallbackErr)}`);
                setStatus("快捷键未启用，请先完成输入监控授权或改用其他快捷键。");
              }
            });
        }
        return undefined;
      })
      .catch((err) => setError(String(err)));
  }, [isTauriRuntime, setConfig]);

  useEffect(() => {
    if (!recordingStartedAt) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [recordingStartedAt]);

  useEffect(() => {
    if (!isTauriRuntime) return;
    const previewText = error || finalText || normalizedText || rawText;
    void invoke("update_capsule", {
      payload: {
        state,
        status,
        previewText,
        startedAt: recordingStartedAt,
        capsuleSize: config.capsuleSize,
      } satisfies CapsulePayload,
    });
  }, [isTauriRuntime, state, status, rawText, normalizedText, finalText, error, recordingStartedAt, config.capsuleSize]);

  const saveConfig = useCallback(async () => {
    if (!isTauriRuntime) {
      setStatus("浏览器预览模式不会写入设置。");
      return;
    }
    try {
      const current = configRef.current;
      const registeredHotkey = await invoke<string>("save_config", { config: current });
      setConfig({ ...current, hotkey: registeredHotkey });
      setError("");
      if (registeredHotkey === "RightOption") {
        setStatus("Right Option 已保存。若你刚打开输入监控权限，请重启 App 后生效。API key 已写入 macOS Keychain。");
      } else {
        setStatus(`设置已保存。快捷键已更新为 ${formatHotkey(registeredHotkey)}。API key 已写入 macOS Keychain。`);
      }
    } catch (err) {
      setError(String(err));
      setStatus("设置保存失败。");
    }
  }, [isTauriRuntime, setConfig]);

  const updateAndSaveConfig = useCallback(
    async (patch: Partial<AppConfig>) => {
      const next = { ...configRef.current, ...patch };
      setConfig(next);
      if (!isTauriRuntime) return;
      try {
        const registeredHotkey = await invoke<string>("save_config", { config: next });
        if (registeredHotkey !== next.hotkey) {
          setConfig({ ...next, hotkey: registeredHotkey });
        }
        setError("");
        setStatus("设置已保存。");
      } catch (err) {
        setError(String(err));
      }
    },
    [isTauriRuntime, setConfig],
  );

  const openInputMonitoringSettings = useCallback(async () => {
    if (!isTauriRuntime) {
      setStatus("请在 Typelesss App 内打开输入监控授权。");
      return;
    }
    try {
      await invoke("open_input_monitoring_settings");
      setStatus("已打开输入监控授权页面。授权 Typelesss 后请重启 App。");
    } catch (err) {
      setError(String(err));
    }
  }, [isTauriRuntime]);

  const openAccessibilitySettings = useCallback(async () => {
    if (!isTauriRuntime) {
      setStatus("请在 Typelesss App 内打开辅助功能授权。");
      return;
    }
    try {
      await invoke("open_accessibility_settings");
      setStatus("已打开辅助功能授权页面。授权 Typelesss 后请重启 App。");
    } catch (err) {
      setError(String(err));
    }
  }, [isTauriRuntime]);

  const installToApplicationsAndOpenPermission = useCallback(async () => {
    if (!isTauriRuntime) {
      setStatus("请在 Typelesss App 内执行安装与授权。");
      return;
    }
    try {
      setStatus("正在打开授权页面。");
      setError("");
      const message = await invoke<string>("install_to_applications_and_open_input_monitoring");
      setStatus(message);
    } catch (err) {
      setError(String(err));
    }
  }, [isTauriRuntime]);

  const startRecording = useCallback(async () => {
    if (!isTauriRuntime) {
      setStatus("浏览器预览模式无法调用系统录音。");
      return;
    }
    setError("");
    setRawText("");
    setNormalizedText("");
    setFinalText("");
    setRecordingStartedAt(Date.now());
    setRuntimeState("recording");
    // UI-triggered recording uses the active preset
    const active = configRef.current.presets.find(
      (p) => p.id === configRef.current.activePresetId,
    );
    if (active) sessionPresetIdRef.current = active.id;
    setStatus("录音中，点击停止后会转写并插入。");
    try {
      await invoke("start_recording");
    } catch (err) {
      setRuntimeState("error");
      setRecordingStartedAt(null);
      setError(String(err));
      setStatus("录音启动失败。");
    }
  }, [isTauriRuntime, setRuntimeState]);

  const stopAndProcess = useCallback(async () => {
    if (!isTauriRuntime) return;
    setRuntimeState("processing");
    setStatus("正在停止录音并请求 ASR。");
    try {
      const activeConfig = configRef.current;
      const sessionPreset =
        activeConfig.presets.find((p) => p.id === sessionPresetIdRef.current) ??
        activeConfig.presets.find((p) => p.id === activeConfig.activePresetId) ??
        activeConfig.presets[0];
      const sessionOutputMode: DictationMode = sessionPreset?.outputMode ?? activeConfig.outputMode;

      const recording = await invoke<RecordingResult>("stop_recording");
      const transcript = await invoke<string>("transcribe_audio", {
        config: activeConfig,
        wavPath: recording.wavPath,
      });
      setRawText(transcript);

      const candidate = normalizeFast(transcript, { mode: sessionOutputMode });
      setNormalizedText(candidate.normalizedText);

      let nextFinal = candidate.normalizedText;
      if (activeConfig.polishProvider !== "disabled" && candidate.shouldUseLlm) {
        setStatus(`ASR 完成，正在调用 polish（${sessionPreset?.label ?? "默认"} 预设）。`);
        const polished = await invoke<string>("polish_text", {
          config: activeConfig,
          text: candidate.normalizedText,
          mode: sessionOutputMode,
        });
        const validation = validatePolishOutput(candidate.normalizedText, polished);
        nextFinal = validation.ok ? polished.trim() : validation.fallbackText ?? candidate.normalizedText;
      }

      setFinalText(nextFinal);
      let deliveryMessage: string;
      if (activeConfig.autoInsert) {
        setStatus("正在插入当前光标。");
        deliveryMessage = await invoke<string>("paste_text", { text: nextFinal });
      } else {
        await invoke("copy_text", { text: nextFinal });
        deliveryMessage = "文本已复制到剪贴板。";
      }

      setRuntimeState("inserted");
      setStatus(
        `完成。${deliveryMessage} 录音 ${Math.round(recording.durationMs)}ms，文本 ${nextFinal.length} 字符。`,
      );

      // Persist to SQLite (best-effort — never blocks UI on failure).
      // startedAt is derived from duration to avoid stale-closure issues with
      // recordingStartedAt (which is reset 900ms after this point).
      const persistedDurationMs = Math.round(recording.durationMs);
      const persistedStartedAt = Date.now() - persistedDurationMs;
      void (async () => {
        try {
          await insertSession(
            {
              startedAt: persistedStartedAt,
              durationMs: persistedDurationMs,
              rawText: transcript,
              normalizedText: candidate.normalizedText,
              finalText: nextFinal,
              outputMode: sessionOutputMode,
              asrProvider: activeConfig.asrProvider,
              polishProvider: activeConfig.polishProvider,
              targetApp: "",
            },
            transcript !== nextFinal
              ? { beforeText: transcript, afterText: nextFinal, source: "auto" }
              : undefined,
          );
          setHistoryRevision((r) => r + 1);
        } catch (err) {
          console.warn("history insert failed (non-fatal):", err);
        }
      })();

      setTimeout(() => {
        setRecordingStartedAt(null);
        setRuntimeState("idle");
      }, 900);
    } catch (err) {
      setRuntimeState("error");
      setError(String(err));
      setRecordingStartedAt(null);
      setStatus("处理失败，文本未插入。");
    }
  }, [isTauriRuntime, setRuntimeState]);

  const cancelRecording = useCallback(async () => {
    if (!isTauriRuntime) return;
    await invoke("cancel_recording").catch(() => undefined);
    setRecordingStartedAt(null);
    setRuntimeState("idle");
    setStatus("已取消。");
  }, [isTauriRuntime, setRuntimeState]);

  const clearTranscript = useCallback(() => {
    setRawText("");
    setNormalizedText("");
    setFinalText("");
  }, []);

  // global hotkey listeners — mounted once, read latest state via refs
  useEffect(() => {
    if (!isTauriRuntime) return undefined;

    const triggerForShortcut = (shortcut: string | undefined) => {
      if (isHotkeyCaptureRef.current) return;
      const preset = findPresetByShortcut(shortcut);
      if (preset) sessionPresetIdRef.current = preset.id;

      if (stateRef.current === "recording") {
        void stopAndProcess();
      } else if (
        stateRef.current === "idle" ||
        stateRef.current === "inserted" ||
        stateRef.current === "error"
      ) {
        void startRecording();
      }
    };

    const triggerStartForShortcut = (shortcut: string | undefined) => {
      if (isHotkeyCaptureRef.current) return;
      const preset = findPresetByShortcut(shortcut);
      if (preset) sessionPresetIdRef.current = preset.id;
      if (
        stateRef.current === "idle" ||
        stateRef.current === "inserted" ||
        stateRef.current === "error"
      ) {
        void startRecording();
      }
    };

    const unlistenToggle = listen<ShortcutTogglePayload>("global-shortcut-toggle", (event) => {
      triggerForShortcut(event.payload?.shortcut);
    });
    const unlistenPressed = listen("global-shortcut-pressed", () => {
      // RightOption press path — match preset by RightOption hotkey
      triggerStartForShortcut("RightOption");
    });
    const unlistenReleased = listen("global-shortcut-released", () => {
      if (isHotkeyCaptureRef.current) return;
      if (stateRef.current === "recording") {
        void stopAndProcess();
      }
    });
    return () => {
      void unlistenToggle.then((dispose) => dispose());
      void unlistenPressed.then((dispose) => dispose());
      void unlistenReleased.then((dispose) => dispose());
    };
  }, [isTauriRuntime, startRecording, stopAndProcess, findPresetByShortcut]);

  const capsuleText = useMemo(() => {
    if (state === "recording") return "正在录音";
    if (state === "processing") return "整理中";
    if (state === "inserted") return "已插入";
    if (state === "error") return "出错";
    return "待命";
  }, [state]);

  const recordingElapsed = recordingStartedAt ? formatElapsed(now - recordingStartedAt) : "00:00";
  const activePreset = useMemo(
    () => config.presets.find((p) => p.id === config.activePresetId) ?? config.presets[0] ?? null,
    [config.presets, config.activePresetId],
  );
  const formattedHotkey = formatHotkey(activePreset?.hotkey ?? config.hotkey);
  const shouldShowInputMonitoringAction = error.includes("输入监控") || status.includes("输入监控");
  const shouldShowAccessibilityAction =
    error.includes("辅助功能") || status.includes("辅助功能") || error.includes("自动粘贴失败");

  const value: AppContextValue = {
    config,
    setConfig,
    state,
    status,
    rawText,
    normalizedText,
    finalText,
    error,
    historyRevision,
    recordingStartedAt,
    recordingElapsed,
    capsuleText,
    formattedHotkey,
    isTauriRuntime,
    shouldShowInputMonitoringAction,
    shouldShowAccessibilityAction,
    activePreset,
    saveConfig,
    updateAndSaveConfig,
    openInputMonitoringSettings,
    openAccessibilitySettings,
    installToApplicationsAndOpenPermission,
    startRecording,
    stopAndProcess,
    cancelRecording,
    clearTranscript,
    setIsHotkeyCapture,
  };

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

function formatElapsed(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}
