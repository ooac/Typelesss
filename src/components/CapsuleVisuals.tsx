import { Check, CircleAlert, Waves } from "lucide-react";
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
      {state === "error" ? <CircleAlert size={22} strokeWidth={2.6} /> : null}
      {state === "idle" || state === "recording" ? <Waves size={20} strokeWidth={2.8} /> : null}
      {state === "idle" ? <span className="capsule-idle-dot" /> : null}
    </span>
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
    </div>
  );
}
