import { useId } from "react";
import { Check } from "lucide-react";
import type { CapsuleSize, RuntimeState } from "../appTypes.js";

export function getCapsuleDisplaySize(size: CapsuleSize, state: RuntimeState): CapsuleSize {
  void state;
  return size;
}

export function capsuleStateLabel(state: RuntimeState): string {
  if (state === "recording") return "正在听...";
  if (state === "processing") return "转写中...";
  if (state === "inserted") return "已输入";
  if (state === "error") return "未识别到语音";
  return "待命";
}

export function capsuleErrorLabel(message: string): string {
  if (isAuthFailure(message)) return "ASR Key 无效";
  if (message.includes("超时") || message.includes("timeout")) return "请求超时";
  if (message.includes("录音太短")) return "录音太短";
  if (message.includes("空文本") || message.includes("可识别的人声")) return "未识别到语音";
  if (message.includes("ASR")) return "ASR 失败";
  if (message.includes("辅助功能") || message.includes("自动粘贴")) return "插入失败";
  return "处理失败";
}

export function isAuthFailure(message: string): boolean {
  return (
    message.includes("Invalid token") ||
    message.includes("API Key") ||
    message.includes("鉴权") ||
    message.includes("401") ||
    message.includes("403")
  );
}

export function capsuleDisplayLabel(state: RuntimeState, message = ""): string {
  if (state === "error") return capsuleErrorLabel(message);
  return capsuleStateLabel(state);
}

export function CapsuleStateIcon({ state }: { state: RuntimeState }) {
  return (
    <span className={`capsule-state-icon capsule-state-icon--${state}`} aria-hidden="true">
      {state === "processing" ? (
        <span className="capsule-spin-dots">
          {Array.from({ length: 12 }).map((_, index) => (
            <span key={index} />
          ))}
        </span>
      ) : null}
      {state === "inserted" ? <Check size={22} strokeWidth={3} /> : null}
      {state === "error" ? <CapsuleErrorGlyph /> : null}
      {state === "idle" || state === "recording" ? <CapsuleWaveGlyph /> : null}
    </span>
  );
}

function CapsuleErrorGlyph() {
  return (
    <svg className="capsule-error-glyph" viewBox="0 0 28 28" role="presentation" focusable="false">
      <circle cx="14" cy="14" r="10.2" />
      <path d="M14 7.8v8.2" />
      <circle cx="14" cy="20.4" r="0.72" />
    </svg>
  );
}

function CapsuleWaveGlyph() {
  const uid = useId().replace(/:/g, "");
  const clipId = `capsule-wave-clip-${uid}`;
  const energyId = `capsule-wave-energy-${uid}`;

  return (
    <svg className="capsule-wave-glyph" viewBox="0 0 44 44" role="presentation" focusable="false">
      <defs>
        <linearGradient id={energyId} x1="8" y1="0" x2="36" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#a8f43f" />
          <stop offset="45%" stopColor="#efffb8" />
          <stop offset="100%" stopColor="#bfff4a" />
        </linearGradient>
        <clipPath id={clipId}>
          <circle cx="22" cy="22" r="21.2" />
        </clipPath>
      </defs>
      <g className="capsule-wave-glyph__mark" clipPath={`url(#${clipId})`}>
        <path className="capsule-wave-glyph__aura" d="M7.8 22c4.4-4.3 9-4.3 13.4 0s9 4.3 15 0" />
        <g className="capsule-wave-glyph__ribbon">
          <path className="capsule-wave-glyph__line" stroke={`url(#${energyId})`} d="M9.2 16.8c4.2-3.2 8.2-3.2 12.4 0s8.2 3.2 13.2 0" />
          <path className="capsule-wave-glyph__line capsule-wave-glyph__line--main" stroke={`url(#${energyId})`} d="M7.8 22c4.4-4.3 9-4.3 13.4 0s9 4.3 15 0" />
          <path className="capsule-wave-glyph__line" stroke={`url(#${energyId})`} d="M9.2 27.2c4.2-3.2 8.2-3.2 12.4 0s8.2 3.2 13.2 0" />
        </g>
        <g className="capsule-wave-glyph__traces">
          <path className="capsule-wave-glyph__trace" pathLength="100" d="M9.2 16.8c4.2-3.2 8.2-3.2 12.4 0s8.2 3.2 13.2 0" />
          <path className="capsule-wave-glyph__trace capsule-wave-glyph__trace--main" pathLength="100" d="M7.8 22c4.4-4.3 9-4.3 13.4 0s9 4.3 15 0" />
          <path className="capsule-wave-glyph__trace" pathLength="100" d="M9.2 27.2c4.2-3.2 8.2-3.2 12.4 0s8.2 3.2 13.2 0" />
        </g>
      </g>
    </svg>
  );
}

export function CapsuleActivityMeter({ state }: { state: RuntimeState }) {
  if (state === "processing") {
    return (
      <div className="capsule-meter capsule-meter--dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    );
  }

  return (
    <div className="capsule-meter" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}
