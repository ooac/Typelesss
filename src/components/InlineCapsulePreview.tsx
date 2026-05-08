import { Waves } from "lucide-react";
import { useApp } from "../state/AppContext.js";
import type { CapsuleSize, RuntimeState } from "../appTypes.js";

const STATE_LABEL: Record<RuntimeState, string> = {
  idle: "待命",
  recording: "正在录音",
  processing: "整理中",
  inserted: "已插入",
  error: "出错",
};

export function InlineCapsulePreview() {
  const { state, status, rawText, normalizedText, finalText, error, recordingElapsed, formattedHotkey, config, updateAndSaveConfig } = useApp();
  const previewText = error || finalText || normalizedText || rawText;
  const detail = previewText.trim()
    ? previewText.trim().slice(0, 80)
    : state === "idle"
      ? `${formattedHotkey} 已保存。若你刚打开输入监控权限，请重启 App 后再按。`
      : status;

  const sizeOptions: { value: CapsuleSize; label: string }[] = [
    { value: "large", label: "大" },
    { value: "medium", label: "中" },
    { value: "small", label: "极小" },
  ];

  return (
    <section className="inline-capsule" aria-label="胶囊预览">
      <div className="inline-capsule__header">
        <span className="inline-capsule__kicker">胶囊预览</span>
        <div className="size-segmented" role="group" aria-label="胶囊尺寸">
          {sizeOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={config.capsuleSize === opt.value ? "is-active" : ""}
              onClick={() => void updateAndSaveConfig({ capsuleSize: opt.value })}
              aria-pressed={config.capsuleSize === opt.value}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className={`inline-capsule__body inline-capsule__body--${config.capsuleSize} ${state}`}>
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
