import { Waves } from "lucide-react";
import { useApp } from "../state/AppContext.js";
import type { RuntimeState } from "../appTypes.js";

const STATE_LABEL: Record<RuntimeState, string> = {
  idle: "待命",
  recording: "正在录音",
  processing: "整理中",
  inserted: "已插入",
  error: "出错",
};

export function InlineCapsulePreview() {
  const { state, status, rawText, normalizedText, finalText, error, recordingElapsed, formattedHotkey } = useApp();
  const previewText = error || finalText || normalizedText || rawText;
  const detail = previewText.trim()
    ? previewText.trim().slice(0, 80)
    : state === "idle"
      ? `${formattedHotkey} 已保存。若你刚打开输入监控权限，请重启 App 后再按。`
      : status;

  return (
    <section className="inline-capsule" aria-label="胶囊预览">
      <span className="inline-capsule__kicker">胶囊预览</span>
      <div className={`inline-capsule__body ${state}`}>
        <div className="capsule-orb" aria-hidden="true">
          <Waves size={20} />
        </div>
        <div className="capsule-copy">
          <strong>
            {STATE_LABEL[state]}
            {state === "recording" ? ` · ${recordingElapsed}` : ""}
          </strong>
          <p>{detail}</p>
        </div>
        <div className="capsule-meter" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>
    </section>
  );
}
