import { useApp } from "../state/AppContext.js";
import type { CapsuleSize } from "../appTypes.js";
import {
  CapsuleActivityMeter,
  CapsuleStateIcon,
  capsuleDisplayLabel,
  getCapsuleDisplaySize,
} from "./CapsuleVisuals.js";

export function InlineCapsulePreview() {
  const { state, status, rawText, normalizedText, finalText, error, recordingElapsed, formattedHotkey, config, updateAndSaveConfig } = useApp();
  const previewText = error || finalText || normalizedText || rawText;
  const detail = previewText.trim()
    ? state === "error"
      ? status
      : previewText.trim().slice(0, 80)
    : state === "idle"
      ? `${formattedHotkey} 已保存。若你刚打开输入监控权限，请重启 App 后再按。`
      : status;
  const displaySize = getCapsuleDisplaySize(config.capsuleSize, state);

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
      <div
        className={`inline-capsule__body inline-capsule__body--${displaySize} inline-capsule__body--configured-${config.capsuleSize} ${state}`}
      >
        <div className="capsule-orb" aria-hidden="true">
          <CapsuleStateIcon state={state} />
        </div>
        <div className="capsule-copy">
          <strong>
            {capsuleDisplayLabel(state, error || status)}
            {state === "recording" ? ` · ${recordingElapsed}` : ""}
          </strong>
          <p>{detail}</p>
        </div>
        <CapsuleActivityMeter state={state} />
      </div>
    </section>
  );
}
