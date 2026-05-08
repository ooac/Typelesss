import { CheckCircle2, Trash2 } from "lucide-react";
import type { Preset } from "../appTypes.js";
import type { DictationMode } from "../types.js";
import { HotkeyRecorder } from "./HotkeyRecorder.js";

interface PresetCardProps {
  preset: Preset;
  isActive: boolean;
  canDelete: boolean;
  onUpdate: (patch: Partial<Preset>) => void;
  onActivate: () => void;
  onDelete: () => void;
}

const MODE_OPTIONS: Array<{ value: DictationMode; label: string }> = [
  { value: "fast_dictation", label: "快速听写" },
  { value: "smart_polish", label: "智能润色" },
  { value: "prompt_builder", label: "提示词构建" },
  { value: "code_prompt", label: "代码提示词" },
];

export function PresetCard({
  preset,
  isActive,
  canDelete,
  onUpdate,
  onActivate,
  onDelete,
}: PresetCardProps) {
  return (
    <article className={`preset-card ${isActive ? "is-active" : ""}`}>
      <header className="preset-card__header">
        <input
          type="text"
          className="preset-card__label-input"
          value={preset.label}
          maxLength={24}
          onChange={(event) => onUpdate({ label: event.target.value })}
          aria-label="预设名称"
        />
        <div className="preset-card__header-actions">
          {isActive ? (
            <span className="preset-card__active-badge">
              <CheckCircle2 size={14} />
              当前
            </span>
          ) : (
            <button type="button" className="ghost compact" onClick={onActivate}>
              设为当前
            </button>
          )}
          {canDelete ? (
            <button
              type="button"
              className="icon-button"
              aria-label="删除预设"
              onClick={onDelete}
            >
              <Trash2 size={16} />
            </button>
          ) : null}
        </div>
      </header>

      <div className="preset-card__grid">
        <label className="preset-card__field">
          <span>快捷键</span>
          <HotkeyRecorder
            hotkey={preset.hotkey}
            onChange={(hotkey) => onUpdate({ hotkey })}
          />
        </label>

        <label className="preset-card__field">
          <span>输出模式</span>
          <select
            value={preset.outputMode}
            onChange={(event) => onUpdate({ outputMode: event.target.value as DictationMode })}
          >
            {MODE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </article>
  );
}
