import {
  ChevronDown,
  CircleHelp,
  Mic,
  MicOff,
  Radio,
  Settings,
  Waves,
} from "lucide-react";
import { navigate } from "../router.js";
import { useApp } from "../state/AppContext.js";

export function Topbar() {
  const { state, capsuleText, formattedHotkey, startRecording, stopAndProcess, cancelRecording } = useApp();
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-orb">
          <Waves size={18} />
        </span>
        <div>
          <strong>Typelesss</strong>
          <span>实时语音输入助手</span>
        </div>
      </div>

      <div className="topbar-center">
        <div className={`status-capsule ${state}`}>
          <span className="pulse" />
          <span>{capsuleText}</span>
        </div>
        <div className="hotkey-chip">
          <span>全局快捷键</span>
          <strong>{formattedHotkey}</strong>
        </div>
      </div>

      <div className="topbar-actions">
        <button
          type="button"
          className="ghost"
          aria-label="设置"
          onClick={() => navigate("providers")}
        >
          <Settings size={15} />
          设置
        </button>
        <button
          type="button"
          className="ghost"
          aria-label="帮助"
          onClick={() => navigate("permissions")}
        >
          <CircleHelp size={15} />
          帮助
        </button>
        {state === "recording" ? (
          <>
            <button type="button" className="primary danger" onClick={stopAndProcess}>
              <MicOff size={15} />
              停止并插入
            </button>
            <button type="button" className="ghost compact" onClick={cancelRecording}>
              取消
            </button>
          </>
        ) : (
          <button
            type="button"
            className="primary"
            disabled={state === "processing"}
            onClick={startRecording}
          >
            <Mic size={15} />
            开始录音
            <ChevronDown size={14} />
          </button>
        )}
      </div>
    </header>
  );
}
