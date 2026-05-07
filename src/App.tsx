import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  KeyRound,
  Mic,
  MicOff,
  Settings,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CapsuleWindow } from "./CapsuleWindow.js";
import { SettingsForm } from "./SettingsForm.js";
import { defaultConfig, fallbackHotkey } from "./appDefaults.js";
import type { AppConfig, CapsulePayload, RecordingResult, RuntimeState } from "./appTypes.js";
import { formatHotkey } from "./hotkey.js";
import { normalizeFast, validatePolishOutput } from "./index.js";
import "./styles.css";

export default function App() {
  if (window.location.hash === "#/capsule") {
    return <CapsuleWindow />;
  }

  const [config, setConfig] = useState<AppConfig>(defaultConfig);
  const [state, setState] = useState<RuntimeState>("idle");
  const [status, setStatus] = useState("准备就绪");
  const [rawText, setRawText] = useState("");
  const [normalizedText, setNormalizedText] = useState("");
  const [finalText, setFinalText] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(true);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const stateRef = useRef<RuntimeState>("idle");
  const configRef = useRef<AppConfig>(defaultConfig);
  const isHotkeyCaptureRef = useRef(false);

  useEffect(() => {
    invoke<AppConfig>("load_config")
      .then((loaded) => {
        const loadedConfig = { ...defaultConfig, ...loaded };
        setConfig(loadedConfig);
        if (loadedConfig.hotkey === "RightOption") {
          return invoke<string>("save_config", { config: loadedConfig })
            .then(() => setStatus("Right Option 已保存。若你刚打开输入监控权限，请重启 App 后再按右 Option。"))
            .catch(async (err) => {
              const fallbackConfig = { ...loadedConfig, hotkey: fallbackHotkey };
              try {
                const registeredHotkey = await invoke<string>("save_config", { config: fallbackConfig });
                setConfig({ ...fallbackConfig, hotkey: registeredHotkey });
                setError(`Right Option 未启用：${String(err)}`);
                setStatus(`已临时启用 ${formatHotkey(registeredHotkey)}。完成输入监控授权后可再改回 Right Option。`);
              } catch (fallbackErr) {
                setError(`${String(err)}；备用快捷键也注册失败：${String(fallbackErr)}`);
                setStatus("快捷键未启用，请先完成输入监控授权或改用其他快捷键。");
              }
            });
        }
        return undefined;
      })
      .catch((err) => setError(String(err)));
  }, []);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    configRef.current = config;
  }, [config]);

  function setRuntimeState(nextState: RuntimeState) {
    stateRef.current = nextState;
    setState(nextState);
  }

  useEffect(() => {
    const previewText = error || finalText || normalizedText || rawText;
    void invoke("update_capsule", {
      payload: {
        state,
        status,
        previewText,
        startedAt: recordingStartedAt,
      } satisfies CapsulePayload,
    });
  }, [state, status, rawText, normalizedText, finalText, error, recordingStartedAt]);

  useEffect(() => {
    const unlistenToggle = listen("global-shortcut-toggle", () => {
      if (isHotkeyCaptureRef.current) return;
      if (stateRef.current === "recording") {
        void stopAndProcess();
      } else if (stateRef.current === "idle" || stateRef.current === "inserted" || stateRef.current === "error") {
        void startRecording();
      }
    });
    const unlistenPressed = listen("global-shortcut-pressed", () => {
      if (isHotkeyCaptureRef.current) return;
      if (stateRef.current === "idle" || stateRef.current === "inserted" || stateRef.current === "error") {
        void startRecording();
      }
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
  }, []);

  const capsuleText = useMemo(() => {
    if (state === "recording") return "正在录音";
    if (state === "processing") return "整理中";
    if (state === "inserted") return "已插入";
    if (state === "error") return "出错";
    return "待命";
  }, [state]);
  const shouldShowInputMonitoringAction = error.includes("输入监控") || status.includes("输入监控");
  const shouldShowAccessibilityAction = error.includes("辅助功能") || status.includes("辅助功能") || error.includes("自动粘贴失败");

  async function saveConfig() {
    try {
      const registeredHotkey = await invoke<string>("save_config", { config });
      setConfig({ ...config, hotkey: registeredHotkey });
      setError("");
      if (registeredHotkey === "RightOption") {
        setStatus("Right Option 已保存。若你刚打开输入监控权限，请重启 App 后生效。API key 已写入 macOS Keychain。");
      } else {
        setStatus(`设置已保存。快捷键已更新为 ${registeredHotkey}。API key 已写入 macOS Keychain。`);
      }
    } catch (err) {
      setError(String(err));
      setStatus("设置保存失败，快捷键未更新。");
    }
  }

  async function openInputMonitoringSettings() {
    try {
      await invoke("open_input_monitoring_settings");
      setStatus("已打开输入监控授权页面。授权 Typelesss 后请重启 App。");
    } catch (err) {
      setError(String(err));
    }
  }

  async function openAccessibilitySettings() {
    try {
      await invoke("open_accessibility_settings");
      setStatus("已打开辅助功能授权页面。授权 Typelesss 后请重启 App。");
    } catch (err) {
      setError(String(err));
    }
  }

  async function installToApplicationsAndOpenPermission() {
    try {
      setStatus("正在打开授权页面。");
      setError("");
      const message = await invoke<string>("install_to_applications_and_open_input_monitoring");
      setStatus(message);
    } catch (err) {
      setError(String(err));
    }
  }

  async function startRecording() {
    setError("");
    setRawText("");
    setNormalizedText("");
    setFinalText("");
    setRecordingStartedAt(Date.now());
    setRuntimeState("recording");
    setStatus("录音中，点击停止后会转写并插入。");
    try {
      await invoke("start_recording");
    } catch (err) {
      setRuntimeState("error");
      setRecordingStartedAt(null);
      setError(String(err));
      setStatus("录音启动失败。");
    }
  }

  async function stopAndProcess() {
    setRuntimeState("processing");
    setStatus("正在停止录音并请求 ASR。");
    try {
      const activeConfig = configRef.current;
      const recording = await invoke<RecordingResult>("stop_recording");
      const transcript = await invoke<string>("transcribe_audio", { config: activeConfig, wavPath: recording.wavPath });
      setRawText(transcript);

      const candidate = normalizeFast(transcript, { mode: activeConfig.outputMode });
      setNormalizedText(candidate.normalizedText);

      let nextFinal = candidate.normalizedText;
      if (activeConfig.polishProvider !== "disabled" && candidate.shouldUseLlm) {
        setStatus("ASR 完成，正在调用 polish。");
        const polished = await invoke<string>("polish_text", {
          config: activeConfig,
          text: candidate.normalizedText,
          mode: activeConfig.outputMode,
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
      setStatus(`完成。${deliveryMessage} 录音 ${Math.round(recording.durationMs)}ms，文本 ${nextFinal.length} 字符。`);
      setHistory((items) => [nextFinal, ...items].slice(0, 8));
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
  }

  async function cancelRecording() {
    await invoke("cancel_recording").catch(() => undefined);
    setRecordingStartedAt(null);
    setRuntimeState("idle");
    setStatus("已取消。");
  }

  return (
    <main className="shell">
      <section className="hero">
        <div className={`capsule ${state}`}>
          <span className="pulse" />
          <span>{capsuleText}</span>
        </div>

        <div className="title-block">
          <p className="eyebrow">Typelesss</p>
          <h1>面向中文、英文和中英混输的桌面语音输入。</h1>
          <p className="summary">
            录音后走 ASR、FastNormalizer、可选 polish，并把最终文本粘贴到当前光标。第一版 macOS 优先。
          </p>
        </div>

        <div className="actions">
          {state === "recording" ? (
            <>
              <button className="primary danger" onClick={stopAndProcess}>
                <MicOff size={20} />
                停止并插入
              </button>
              <button className="ghost" onClick={cancelRecording}>
                取消
              </button>
            </>
          ) : (
            <button className="primary" disabled={state === "processing"} onClick={startRecording}>
              <Mic size={20} />
              开始录音
            </button>
          )}
          <button className="ghost" onClick={() => setShowSettings((value) => !value)}>
            <Settings size={19} />
            设置
          </button>
        </div>
      </section>

      <section className="status-row">
        <div>
          <CheckCircle2 size={18} />
          <span>{status}</span>
        </div>
        <div>
          <KeyRound size={18} />
          <span>全局快捷键：{formatHotkey(config.hotkey)}</span>
        </div>
      </section>

      {error ? (
        <section className="error-panel">
          <AlertTriangle size={18} />
          <span>{error}</span>
          {shouldShowInputMonitoringAction ? (
            <>
              <button className="inline-action" onClick={installToApplicationsAndOpenPermission}>
                <Settings size={15} />
                安装并打开授权
              </button>
              <button className="inline-action" onClick={openInputMonitoringSettings}>
                <Settings size={15} />
                只打开授权页
              </button>
            </>
          ) : null}
          {shouldShowAccessibilityAction ? (
            <button className="inline-action" onClick={openAccessibilitySettings}>
              <Settings size={15} />
              打开辅助功能授权
            </button>
          ) : null}
        </section>
      ) : null}

      <section className="grid">
        <article className="panel transcript-panel">
          <header>
            <Sparkles size={18} />
            <h2>输入链路输出</h2>
          </header>
          <TextBlock label="ASR Raw" value={rawText} />
          <TextBlock label="Fast Normalized" value={normalizedText} />
          <TextBlock label="Final" value={finalText} strong />
        </article>

        {showSettings ? (
          <article className="panel settings-panel">
            <header>
              <Settings size={18} />
              <h2>Provider 设置</h2>
            </header>
            <SettingsForm
              config={config}
              setConfig={setConfig}
              onSave={saveConfig}
              onOpenInputMonitoringSettings={openInputMonitoringSettings}
              onOpenAccessibilitySettings={openAccessibilitySettings}
              onInstallToApplicationsAndOpenPermission={installToApplicationsAndOpenPermission}
              onHotkeyCaptureChange={(isCapturing) => {
                isHotkeyCaptureRef.current = isCapturing;
              }}
            />
          </article>
        ) : (
          <article className="panel history-panel">
            <header>
              <Clipboard size={18} />
              <h2>最近结果</h2>
            </header>
            {history.length === 0 ? <p className="empty">暂无历史。</p> : history.map((item) => <p key={item}>{item}</p>)}
          </article>
        )}
      </section>
    </main>
  );
}

function TextBlock({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? "text-block strong" : "text-block"}>
      <span>{label}</span>
      <p>{value || "等待内容。"}</p>
    </div>
  );
}
