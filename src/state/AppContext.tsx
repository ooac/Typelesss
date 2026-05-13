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
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { defaultConfig, mergeLoadedConfig, normalizeAsrProviderConfig } from "../appDefaults.js";
import type {
  AppConfig,
  CapsulePayload,
  Preset,
  RecordingResult,
  RuntimeState,
} from "../appTypes.js";
import type { DictionaryEntry } from "../dictionary/builtin.js";
import {
  inferReadbackCorrection,
  inferSelectedTextCorrection,
  isSafeLearnedCorrection,
} from "../correction/learnedCorrection.js";
import {
  insertCorrectionPair,
  insertSession,
  learnPersonalTermsFromText,
  listCorrectionPairs,
  listPersonalTerms,
  recordAsrTelemetry,
  upsertPersonalTerm,
} from "../db/historyRepo.js";
import { chooseBestTranscript, chooseRealtimeFinalCandidate } from "../asr/finalCandidateGuard.js";
import { isRealtimeAsrProvider, latestRealtimeText } from "../asr/realtimeProviders.js";
import { formatHotkey } from "../hotkey.js";
import { normalizeFast, validatePolishOutput } from "../index.js";
import { TranscriptStabilizer } from "../realtime/stabilizer.js";
import type { DictationMode, TranscriptEvent } from "../types.js";

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
  learnSelectedText: () => Promise<void>;
  clearTranscript: () => void;
  setIsHotkeyCapture: (capturing: boolean) => void;
}

interface ShortcutTogglePayload {
  shortcut?: string;
}

const REALTIME_TERMS = [
  "Claude Code",
  "OpenAI Codex",
  "Tauri",
  "src-tauri",
  "TranscriptEvent",
  "ShadowBuffer",
  "WebSocket",
  "TypeScript",
  "Rust",
  "React",
  "Vite",
];

interface SessionTelemetryDraft {
  hotkeyDownAt: number;
  firstAudioSentAt: number | null;
  firstPartialAt: number | null;
  stableInsertAt: number | null;
  finalReceivedAt: number | null;
  insertDoneAt: number | null;
}

interface ReadbackResult {
  sessionId: string;
  targetApp: string;
  insertedText: string;
  editedText: string;
  readText: string;
  learned: boolean;
  reason: string;
}

interface LearnSelectedTextResult {
  selectedText: string;
  targetApp: string;
  matchedSessionId?: string | null;
  insertedText: string;
  learned: boolean;
  reason: string;
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
  const realtimeStabilizerRef = useRef(new TranscriptStabilizer({ dictionaryTerms: REALTIME_TERMS }));
  const streamingPreviewRef = useRef("");
  const streamingFinalRef = useRef("");
  const streamingErrorRef = useRef("");
  const streamingFinalWaitersRef = useRef<Array<(text: string) => void>>([]);
  const compositionSessionRef = useRef<string | null>(null);
  const liveStableTextRef = useRef("");
  const liveInsertFailedRef = useRef(false);
  const personalTermsRef = useRef<string[]>([]);
  const correctionEntriesRef = useRef<DictionaryEntry[]>([]);
  const sessionTelemetryRef = useRef<SessionTelemetryDraft | null>(null);
  const idleResetTimerRef = useRef<number | null>(null);
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

  const clearIdleResetTimer = useCallback(() => {
    if (idleResetTimerRef.current !== null) {
      window.clearTimeout(idleResetTimerRef.current);
      idleResetTimerRef.current = null;
    }
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

  // load_config must never rewrite the user's shortcut. Registration errors are surfaced,
  // but the configured hotkey remains the single source of truth.
  useEffect(() => {
    if (!isTauriRuntime) {
      setStatus("浏览器预览模式：原生录音和系统授权需在 Typelesss App 内使用。");
      return;
    }
    invoke<AppConfig>("load_config")
      .then((loaded) => {
        const mergedConfig = mergeLoadedConfig(loaded);
        const loadedConfig = normalizeAsrProviderConfig(mergedConfig);
        setConfig(loadedConfig);
        sessionPresetIdRef.current = loadedConfig.activePresetId || loadedConfig.presets[0]?.id || "default";
        if (
          loadedConfig.asrEndpoint !== mergedConfig.asrEndpoint ||
          loadedConfig.asrModel !== mergedConfig.asrModel
        ) {
          void invoke<string>("save_config", { config: loadedConfig }).catch((err) => {
            console.warn("normalize asr provider config failed:", err);
          });
        }
        const activeHotkey =
          loadedConfig.presets.find((preset) => preset.id === loadedConfig.activePresetId)?.hotkey ??
          loadedConfig.hotkey;
        if (activeHotkey === "RightOption") {
          setStatus("Right Option 已保留。若未生效，请先完成输入监控授权或重启 App。");
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
    void Promise.all([listPersonalTerms(), listCorrectionPairs()])
      .then(([terms, corrections]) => {
        personalTermsRef.current = terms.map((term) => term.canonical);
        correctionEntriesRef.current = corrections
          .filter((pair) => isSafeLearnedCorrection(pair.beforeText, pair.afterText))
          .map((pair) => ({
            canonical: pair.afterText,
            aliases: [pair.beforeText],
            category: "coding",
            language: /[\u3400-\u9fff]/u.test(pair.afterText) ? "mixed" : "en",
          }));
        realtimeStabilizerRef.current = new TranscriptStabilizer({
          dictionaryTerms: [...REALTIME_TERMS, ...personalTermsRef.current],
        });
      })
      .catch((err) => console.warn("load personal terms failed:", err));
  }, [isTauriRuntime, historyRevision]);

  useEffect(() => {
    if (!isTauriRuntime) return undefined;
    const unlisten = listen<TranscriptEvent>("transcript-event", (event) => {
      const payload = event.payload;
      if (!payload) return;
      if (payload.kind !== "error" && payload.isLowInformation) return;

      if (payload.kind === "partial") {
        if (!sessionTelemetryRef.current?.firstPartialAt) {
          sessionTelemetryRef.current = {
            ...(sessionTelemetryRef.current ?? makeTelemetryDraft()),
            firstPartialAt: Date.now(),
          };
        }
        const output = realtimeStabilizerRef.current.onPartial(payload.text);
        const previewText = output.previewText || payload.text;
        streamingPreviewRef.current = previewText;
        streamingFinalRef.current = previewText;
        streamingErrorRef.current = "";
        setError("");
        setRawText(previewText);
        setNormalizedText(output.stableText || previewText);
        setFinalText(previewText);
        setStatus("实时转写中。");
        if (output.stableText && output.stableText !== liveStableTextRef.current) {
          void applyLiveComposition(output.stableText, "stable", compositionSessionRef, liveStableTextRef, liveInsertFailedRef, sessionTelemetryRef);
        }
        return;
      }

      if (payload.kind === "stable") {
        if (!sessionTelemetryRef.current?.stableInsertAt) {
          sessionTelemetryRef.current = {
            ...(sessionTelemetryRef.current ?? makeTelemetryDraft()),
            stableInsertAt: Date.now(),
          };
        }
        setNormalizedText(payload.text);
        streamingPreviewRef.current = payload.text;
        streamingFinalRef.current = payload.text;
        streamingErrorRef.current = "";
        setError("");
        if (payload.text && payload.text !== liveStableTextRef.current) {
          void applyLiveComposition(payload.text, "stable", compositionSessionRef, liveStableTextRef, liveInsertFailedRef, sessionTelemetryRef);
        }
        return;
      }

      if (payload.kind === "final") {
        sessionTelemetryRef.current = {
          ...(sessionTelemetryRef.current ?? makeTelemetryDraft()),
          finalReceivedAt: Date.now(),
        };
        const output = realtimeStabilizerRef.current.onFinal(payload.text);
        const text = output.previewText;
        streamingPreviewRef.current = text;
        streamingFinalRef.current = text;
        streamingErrorRef.current = "";
        setError("");
        setRawText(text);
        setNormalizedText(text);
        setFinalText(text);
        setStatus("实时 ASR final 已返回，正在整理。");
        const waiters = streamingFinalWaitersRef.current.splice(0);
        waiters.forEach((resolve) => resolve(text));
        return;
      }

      if (payload.kind === "error") {
        const message = payload.errorMessage || "实时 ASR 失败";
        streamingErrorRef.current = message;
        const fallbackText = latestRealtimeText(streamingFinalRef.current, streamingPreviewRef.current);
        if (fallbackText.trim()) {
          setStatus(`实时 ASR 连接结束，已使用当前文本继续：${message}`);
          const waiters = streamingFinalWaitersRef.current.splice(0);
          waiters.forEach((resolve) => resolve(fallbackText));
          return;
        }
        setError(message);
        setStatus(
          configRef.current.asrProvider === "auto_optimized"
            ? `实时 ASR 失败，停止后会自动切换候选：${message}`
            : `实时 ASR 失败：${message}`,
        );
        const waiters = streamingFinalWaitersRef.current.splice(0);
        waiters.forEach((resolve) => resolve(""));
      }
    });

    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, [isTauriRuntime]);

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
      const current = normalizeShortcutConfig(configRef.current, {
        hotkey: configRef.current.hotkey,
        outputMode: configRef.current.outputMode,
      });
      await invoke<string>("save_config", { config: current });
      setConfig(current);
      setError("");
      const activeHotkey =
        current.presets.find((preset) => preset.id === current.activePresetId)?.hotkey ?? current.hotkey;
      if (activeHotkey === "RightOption") {
        setStatus("Right Option 已保存。若你刚打开输入监控权限，请重启 App 后生效。API key 已写入 macOS Keychain。");
      } else {
        setStatus(`设置已保存。快捷键保持为 ${formatHotkey(activeHotkey)}。API key 已写入 macOS Keychain。`);
      }
    } catch (err) {
      setError(String(err));
      setStatus("设置保存失败。");
    }
  }, [isTauriRuntime, setConfig]);

  const updateAndSaveConfig = useCallback(
    async (patch: Partial<AppConfig>) => {
      const next = normalizeShortcutConfig(configRef.current, patch);
      setConfig(next);
      if (!isTauriRuntime) return;
      try {
        await invoke<string>("save_config", { config: next });
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
    clearIdleResetTimer();
    setError("");
    setRawText("");
    setNormalizedText("");
    setFinalText("");
    streamingFinalRef.current = "";
    streamingPreviewRef.current = "";
    streamingErrorRef.current = "";
    compositionSessionRef.current = null;
    liveStableTextRef.current = "";
    liveInsertFailedRef.current = false;
    realtimeStabilizerRef.current.reset();
    streamingFinalWaitersRef.current.splice(0).forEach((resolve) => resolve(""));
    sessionTelemetryRef.current = makeTelemetryDraft();
    setRecordingStartedAt(Date.now());
    setRuntimeState("recording");
    // UI-triggered recording uses the active preset
    const active = configRef.current.presets.find(
      (p) => p.id === configRef.current.activePresetId,
    );
    if (active) sessionPresetIdRef.current = active.id;
    const supportsRealtimeAsr = isRealtimeAsrProvider(configRef.current.asrProvider);
    setStatus(
      supportsRealtimeAsr
        ? "实时 ASR 已启动，正在监听。"
        : "录音中，本地模型会在停止后快速转写并插入。",
    );
    try {
      await invoke("start_recording", { config: configRef.current });
      sessionTelemetryRef.current = {
        ...(sessionTelemetryRef.current ?? makeTelemetryDraft()),
        firstAudioSentAt: Date.now(),
      };
      if (supportsRealtimeAsr && configRef.current.liveInsertEnabled && configRef.current.autoInsert) {
        try {
          compositionSessionRef.current = await invoke<string>("begin_composition");
        } catch (err) {
          console.warn("live composition begin failed, falling back to final paste:", err);
          liveInsertFailedRef.current = true;
        }
      }
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
    setStatus("正在停止录音。");
    let recordingForCleanup: RecordingResult | null = null;
    try {
      const activeConfig = configRef.current;
      const sessionPreset =
        activeConfig.presets.find((p) => p.id === sessionPresetIdRef.current) ??
        activeConfig.presets.find((p) => p.id === activeConfig.activePresetId) ??
        activeConfig.presets[0];
      const sessionOutputMode: DictationMode = sessionPreset?.outputMode ?? activeConfig.outputMode;

      const recording = await withTimeout(
        invoke<RecordingResult>("stop_recording"),
        5_000,
        "停止录音",
      );
      recordingForCleanup = recording;
      if (recording.audioQuality.peak < 0.012 || recording.audioQuality.audibleRatio < 0.01) {
        setStatus(
          `录音音量偏低：peak ${recording.audioQuality.peak.toFixed(3)}，有效语音 ${(recording.audioQuality.audibleRatio * 100).toFixed(1)}%。`,
        );
      }
      let transcript = "";
      if (isRealtimeAsrProvider(activeConfig.asrProvider)) {
        setStatus("正在等待实时 ASR final。");
        const existingRealtimeText = latestRealtimeText(streamingFinalRef.current, streamingPreviewRef.current);
        const realtimeFinal =
          existingRealtimeText ||
          (await waitForStreamingFinal(streamingFinalWaitersRef, streamingFinalRef, 1_500)) ||
          latestRealtimeText(streamingFinalRef.current, streamingPreviewRef.current);
        const realtimeDecision = chooseRealtimeFinalCandidate(realtimeFinal, streamingPreviewRef.current, recording.durationMs);
        transcript = realtimeDecision.text;
        if (!transcript.trim() && streamingErrorRef.current && activeConfig.asrProvider !== "auto_optimized") {
          throw new Error(streamingErrorRef.current);
        }
        if (!transcript.trim() && streamingErrorRef.current) {
          setStatus("实时 ASR 没有可用 final，正在切换自动候选。");
        } else if (activeConfig.asrProvider === "auto_optimized" && realtimeDecision.needsFullAudioReview) {
          setStatus(`实时 final 疑似不完整（${realtimeDecision.reason}），正在用完整录音复核。`);
          try {
            const reviewed = await withTimeout(
              invoke<string>("transcribe_audio", {
                config: activeConfig,
                wavPath: recording.wavPath,
              }),
              Math.min(30_000, Math.max(8_000, Math.ceil(recording.durationMs * 4 + 4_000))),
              "完整录音复核",
            );
            transcript = chooseBestTranscript(transcript, reviewed);
            sessionTelemetryRef.current = {
              ...(sessionTelemetryRef.current ?? makeTelemetryDraft()),
              finalReceivedAt: Date.now(),
            };
          } catch (err) {
            console.warn("full audio review failed, using realtime candidate:", err);
          }
        }
      }
      if (!transcript.trim()) {
        const realtimeFallback = latestRealtimeText(streamingFinalRef.current, streamingPreviewRef.current);
        if (isRealtimeAsrProvider(activeConfig.asrProvider) && realtimeFallback.trim()) {
          transcript = realtimeFallback;
        }
      }
      if (!transcript.trim()) {
        const isLocalAsr = activeConfig.asrProvider === "local_hybrid";
        const isAutoAsr = activeConfig.asrProvider === "auto_optimized";
        setStatus(isLocalAsr ? "正在本地模型转写。" : isAutoAsr ? "正在自动选择最快可用 ASR。" : "正在上传录音并请求 ASR。");
        const asrTimeoutMs = isLocalAsr || isAutoAsr
          ? Math.min(30_000, Math.max(8_000, Math.ceil(recording.durationMs * 4 + 4_000)))
          : 30_000;
        transcript = await withTimeout(
          invoke<string>("transcribe_audio", {
            config: activeConfig,
            wavPath: recording.wavPath,
          }),
          asrTimeoutMs,
          "ASR",
        );
        sessionTelemetryRef.current = {
          ...(sessionTelemetryRef.current ?? makeTelemetryDraft()),
          finalReceivedAt: Date.now(),
        };
      }
      setRawText(transcript);

      const candidate = normalizeFast(transcript, {
        mode: sessionOutputMode,
        dictionaryEntries: [
          ...correctionEntriesRef.current,
          ...personalDictionaryEntries(personalTermsRef.current),
        ],
      });
      setNormalizedText(candidate.normalizedText);

      let nextFinal = candidate.normalizedText;
      const shouldRemotePolish =
        activeConfig.polishProvider !== "disabled" &&
        candidate.shouldUseLlm &&
        (sessionOutputMode === "prompt_builder" || sessionOutputMode === "code_prompt");
      if (shouldRemotePolish) {
        setStatus(`ASR 完成，正在调用 polish（${sessionPreset?.label ?? "默认"} 预设）。`);
        try {
          const polished = await withTimeout(
            invoke<string>("polish_text", {
              config: activeConfig,
              text: candidate.normalizedText,
              mode: sessionOutputMode,
            }),
            20_000,
            "Polish",
          );
          const validation = validatePolishOutput(candidate.normalizedText, polished);
          nextFinal = validation.ok ? polished.trim() : validation.fallbackText ?? candidate.normalizedText;
        } catch (err) {
          console.warn("polish failed, falling back to normalized transcript:", err);
          setStatus("Polish 失败，已使用本地整理文本继续。");
        }
      }

      setFinalText(nextFinal);
      let deliveryMessage: string;
      if (activeConfig.autoInsert) {
        setStatus("正在插入当前光标。");
        if (activeConfig.liveInsertEnabled && compositionSessionRef.current && !liveInsertFailedRef.current) {
          try {
            deliveryMessage = await withTimeout(
              invoke<string>("apply_composition_patch", {
                sessionId: compositionSessionRef.current,
                text: nextFinal,
                kind: "final",
              }),
              8_000,
              "实时替换最终文本",
            );
            await invoke("finish_composition", { sessionId: compositionSessionRef.current });
            compositionSessionRef.current = null;
          } catch (err) {
            console.warn("live final replace failed, falling back to final paste:", err);
            if (compositionSessionRef.current) {
              await invoke("cancel_composition", { sessionId: compositionSessionRef.current }).catch(() => undefined);
              compositionSessionRef.current = null;
            }
            deliveryMessage = await withTimeout(
              invoke<string>("paste_text", { text: nextFinal }),
              8_000,
              "插入文本",
            );
          }
        } else {
          deliveryMessage = await withTimeout(
            invoke<string>("paste_text", { text: nextFinal }),
            8_000,
            "插入文本",
          );
        }
      } else {
        await withTimeout(invoke("copy_text", { text: nextFinal }), 5_000, "复制文本");
        deliveryMessage = "文本已复制到剪贴板。";
      }
      sessionTelemetryRef.current = {
        ...(sessionTelemetryRef.current ?? makeTelemetryDraft()),
        insertDoneAt: Date.now(),
      };

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
          const savedSession = await insertSession(
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
          await Promise.allSettled([
            recordAsrTelemetry({
              sessionId: savedSession.id,
              providerId: activeConfig.asrProvider,
              targetApp: "",
              ...(sessionTelemetryRef.current ?? makeTelemetryDraft()),
            }),
            learnPersonalTermsFromText(nextFinal, "session"),
          ]);
          if (activeConfig.autoInsert) {
            await invoke("remember_recent_insert_context", {
              payload: {
                sessionId: savedSession.id,
                rawText: transcript,
                finalText: nextFinal,
                insertedText: nextFinal,
                insertedAtMs: Date.now(),
              },
            }).catch((err) => console.warn("remember insert context failed:", err));
            schedulePostInsertReadback(savedSession.id, nextFinal, setHistoryRevision);
          }
          setHistoryRevision((r) => r + 1);
        } catch (err) {
          console.warn("history insert failed (non-fatal):", err);
        }
      })();

      clearIdleResetTimer();
      idleResetTimerRef.current = window.setTimeout(() => {
        idleResetTimerRef.current = null;
        if (stateRef.current !== "inserted") return;
        setRecordingStartedAt(null);
        setRuntimeState("idle");
      }, 900);
    } catch (err) {
      const message = String(err);
      const realtimeFallback = latestRealtimeText(streamingFinalRef.current, streamingPreviewRef.current);
      if (isRealtimeAsrProvider(configRef.current.asrProvider) && realtimeFallback && isRecoverableRealtimeAsrFailure(message)) {
        try {
          const activeConfig = configRef.current;
          const activePreset =
            activeConfig.presets.find((p) => p.id === sessionPresetIdRef.current) ??
            activeConfig.presets.find((p) => p.id === activeConfig.activePresetId) ??
            activeConfig.presets[0];
          const candidate = normalizeFast(realtimeFallback, {
            mode: activePreset?.outputMode ?? activeConfig.outputMode,
            dictionaryEntries: [
              ...correctionEntriesRef.current,
              ...personalDictionaryEntries(personalTermsRef.current),
            ],
          });
          const finalFallback = candidate.normalizedText;
          setError("");
          setRawText(realtimeFallback);
          setNormalizedText(candidate.normalizedText);
          setFinalText(finalFallback);
          const deliveryMessage = activeConfig.autoInsert
            ? await withTimeout(invoke<string>("paste_text", { text: finalFallback }), 8_000, "插入实时文本")
            : (await withTimeout(invoke("copy_text", { text: finalFallback }), 5_000, "复制实时文本"), "文本已复制到剪贴板。");
          setRuntimeState("inserted");
          setStatus(`完成。${deliveryMessage} 已使用实时 ASR 当前文本兜底，未走 batch。`);
          clearIdleResetTimer();
          idleResetTimerRef.current = window.setTimeout(() => {
            idleResetTimerRef.current = null;
            if (stateRef.current !== "inserted") return;
            setRecordingStartedAt(null);
            setRuntimeState("idle");
          }, 900);
          return;
        } catch (recoveryErr) {
          console.warn("realtime fallback insert failed:", recoveryErr);
        }
      }
      setRuntimeState("error");
      setError(message);
      setRecordingStartedAt(null);
      setStatus(processingFailureStatus(message));
    } finally {
      if (recordingForCleanup?.wavPath) {
        void invoke("cleanup_recording_file", { wavPath: recordingForCleanup.wavPath }).catch((err) => {
          console.warn("cleanup recording failed:", err);
        });
      }
    }
  }, [clearIdleResetTimer, isTauriRuntime, setRuntimeState]);

  const cancelRecording = useCallback(async () => {
    if (!isTauriRuntime) return;
    clearIdleResetTimer();
    await invoke("cancel_recording").catch(() => undefined);
    if (compositionSessionRef.current) {
      await invoke("cancel_composition", { sessionId: compositionSessionRef.current }).catch(() => undefined);
      compositionSessionRef.current = null;
    }
    liveStableTextRef.current = "";
    liveInsertFailedRef.current = false;
    setRecordingStartedAt(null);
    setRuntimeState("idle");
    setStatus("已取消。");
  }, [clearIdleResetTimer, isTauriRuntime, setRuntimeState]);

  const clearTranscript = useCallback(() => {
    setRawText("");
    setNormalizedText("");
    setFinalText("");
    streamingFinalRef.current = "";
    streamingPreviewRef.current = "";
    streamingErrorRef.current = "";
    realtimeStabilizerRef.current.reset();
  }, []);

  const learnSelectedText = useCallback(async () => {
    if (!isTauriRuntime) {
      setStatus("请在 Typelesss App 内使用选中文本学习。");
      return;
    }
    try {
      const result = await invoke<LearnSelectedTextResult>("learn_selected_text");
      const selectedText = result.selectedText.trim();
      if (!selectedText) {
        setStatus("没有读到选中文本。请先在目标软件里选中修正后的词。");
        return;
      }
      let learnedCorrection = false;
      const correction = result.matchedSessionId
        ? inferSelectedTextCorrection(result.insertedText, selectedText)
        : null;
      if (result.matchedSessionId && correction) {
        learnedCorrection = await insertCorrectionPair(
          result.matchedSessionId,
          correction.beforeText,
          correction.afterText,
          "selected_text",
        );
      }
      if (!learnedCorrection) {
        await upsertPersonalTerm(selectedText, [], "selected_text");
      }
      setHistoryRevision((r) => r + 1);
      setStatus(
        learnedCorrection
          ? `已学习纠错：${correction?.beforeText} → ${correction?.afterText}`
          : `已学习术语：${selectedText}`,
      );
    } catch (err) {
      setError(String(err));
      setStatus("学习选中文本失败。");
    }
  }, [isTauriRuntime]);

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
    const unlistenCapsuleToggle = listen("capsule-toggle-request", () => {
      triggerForShortcut(undefined);
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
      void unlistenCapsuleToggle.then((dispose) => dispose());
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
    learnSelectedText,
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

function processingFailureStatus(message: string) {
  if (message.includes("录音太短")) return "录音太短，请至少说半秒以上。";
  if (message.includes("API Key") || message.includes("鉴权") || message.includes("401") || message.includes("403")) {
    return "鉴权失败，请检查服务商 API Key。";
  }
  if (message.includes("timeout") || message.includes("超时")) return "请求超时，请检查网络或服务商状态。";
  if (message.includes("ASR")) return "ASR 失败，文本未插入。";
  return "处理失败，文本未插入。";
}

function isRecoverableRealtimeAsrFailure(message: string): boolean {
  return /ASR|batch|final|realtime|实时|腾讯云|转写|未返回/u.test(message);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} 超时（${Math.round(timeoutMs / 1000)}s）`));
    }, timeoutMs);

    promise
      .then(resolve, reject)
      .finally(() => window.clearTimeout(timer));
  });
}

function waitForStreamingFinal(
  waitersRef: { current: Array<(text: string) => void> },
  finalRef: { current: string },
  timeoutMs: number,
): Promise<string> {
  if (finalRef.current.trim()) return Promise.resolve(finalRef.current);
  return new Promise((resolve) => {
    let waiter: (text: string) => void;
    const timer = window.setTimeout(() => {
      waitersRef.current = waitersRef.current.filter((item) => item !== waiter);
      resolve("");
    }, timeoutMs);
    waiter = (text) => {
      window.clearTimeout(timer);
      resolve(text);
    };
    waitersRef.current.push(waiter);
  });
}

async function applyLiveComposition(
  text: string,
  kind: "stable" | "final",
  sessionRef: { current: string | null },
  stableRef: { current: string },
  failedRef: { current: boolean },
  telemetryRef: { current: SessionTelemetryDraft | null },
): Promise<void> {
  if (!sessionRef.current || failedRef.current || !text.trim()) return;
  try {
    await invoke<string>("apply_composition_patch", {
      sessionId: sessionRef.current,
      text,
      kind,
    });
    stableRef.current = text;
    if (!telemetryRef.current?.stableInsertAt) {
      telemetryRef.current = {
        ...(telemetryRef.current ?? makeTelemetryDraft()),
        stableInsertAt: Date.now(),
      };
    }
  } catch (err) {
    console.warn("live composition failed, disabling for this session:", err);
    failedRef.current = true;
    if (sessionRef.current) {
      await invoke("cancel_composition", { sessionId: sessionRef.current }).catch(() => undefined);
      sessionRef.current = null;
    }
  }
}

function schedulePostInsertReadback(
  sessionId: string,
  insertedText: string,
  bumpHistory: Dispatch<SetStateAction<number>>,
): void {
  [2_000, 6_000].forEach((delayMs) => {
    window.setTimeout(() => {
      void (async () => {
        try {
          const result = await invoke<ReadbackResult>("read_recent_insert_context", {
            sessionId,
          });
          const correction = inferReadbackCorrection(insertedText, result.editedText || result.readText);
          if (!correction) return;
          const learned = await insertCorrectionPair(
            sessionId,
            correction.beforeText,
            correction.afterText,
            "post_insert_readback",
          );
          if (learned) bumpHistory((revision) => revision + 1);
        } catch (err) {
          console.warn("post insert readback skipped:", err);
        }
      })();
    }, delayMs);
  });
}

function makeTelemetryDraft(): SessionTelemetryDraft {
  return {
    hotkeyDownAt: Date.now(),
    firstAudioSentAt: null,
    firstPartialAt: null,
    stableInsertAt: null,
    finalReceivedAt: null,
    insertDoneAt: null,
  };
}

function personalDictionaryEntries(terms: string[]): DictionaryEntry[] {
  return terms
    .filter((term) => term.trim().length > 1)
    .slice(0, 80)
    .map((term) => ({
      canonical: term,
      aliases: [],
      category: "coding",
      language: /[\u3400-\u9fff]/u.test(term) ? "zh" : "mixed",
    }));
}

function normalizeShortcutConfig(current: AppConfig, patch: Partial<AppConfig>): AppConfig {
  const next = { ...current, ...patch };
  const presets = Array.isArray(next.presets) ? next.presets.map((preset) => ({ ...preset })) : [];
  const activeIndex = presets.findIndex((preset) => preset.id === next.activePresetId);
  if (activeIndex < 0) return next;

  const patchHasHotkey = Object.prototype.hasOwnProperty.call(patch, "hotkey");
  const patchHasOutputMode = Object.prototype.hasOwnProperty.call(patch, "outputMode");
  if (patchHasHotkey) presets[activeIndex].hotkey = next.hotkey;
  if (patchHasOutputMode) presets[activeIndex].outputMode = next.outputMode;

  const active = presets[activeIndex];
  return {
    ...next,
    presets,
    hotkey: active.hotkey || next.hotkey,
    outputMode: active.outputMode || next.outputMode,
  };
}
