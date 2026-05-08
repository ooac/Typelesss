import { listen } from "@tauri-apps/api/event";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Waves } from "lucide-react";
import { useEffect, useLayoutEffect, useState, type PointerEvent } from "react";
import type { CapsulePayload, CapsuleSize, RuntimeState } from "./appTypes.js";

const SIZE_MAP: Record<CapsuleSize, { width: number; height: number }> = {
  large: { width: 360, height: 70 },
  medium: { width: 300, height: 58 },
  small: { width: 240, height: 46 },
};

export function CapsuleWindow() {
  const [payload, setPayload] = useState<CapsulePayload>({
    state: "idle",
    status: "准备就绪",
    previewText: "",
    startedAt: null,
    capsuleSize: "large",
  });
  const [now, setNow] = useState(Date.now());

  useLayoutEffect(() => {
    document.documentElement.classList.add("capsule-root");
    document.body.classList.add("capsule-body");
    return () => {
      document.documentElement.classList.remove("capsule-root");
      document.body.classList.remove("capsule-body");
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const unlisten = listen<CapsulePayload>("capsule-state", (event) => {
      const next = event.payload;
      setPayload((prev) => {
        if (prev.capsuleSize !== next.capsuleSize) {
          const { width, height } = SIZE_MAP[next.capsuleSize];
          const win = getCurrentWindow();
          void win.setMinSize(new LogicalSize(180, 40));
          void win.setSize(new LogicalSize(width, height));
        }
        return next;
      });
    });
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  const elapsed = payload.startedAt ? Math.max(0, now - payload.startedAt) : 0;
  const elapsedText = formatElapsed(elapsed);
  const shouldShowElapsed = payload.state === "recording";
  const detailText = capsuleDetailText(payload);
  const startCapsuleDrag = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    void getCurrentWindow().startDragging();
  };

  return (
    <main
      className={`floating-capsule floating-capsule--${payload.capsuleSize} ${payload.state}`}
      data-tauri-drag-region
      onPointerDown={startCapsuleDrag}
    >
      <div className="capsule-core">
        <div className="capsule-orb" aria-hidden="true">
          <Waves size={18} />
        </div>
        <div className="capsule-copy">
          <div className="capsule-topline">
            <span>{stateLabel(payload.state)}</span>
            {shouldShowElapsed ? <strong>{elapsedText}</strong> : null}
          </div>
          <p>{detailText}</p>
        </div>
        <div className="capsule-meter" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>
    </main>
  );
}

function capsuleDetailText(payload: CapsulePayload) {
  if (payload.previewText.trim()) {
    return payload.previewText.trim().slice(0, 34);
  }
  if (payload.state === "recording") {
    return "麦克风已打开，松手或再次按快捷键停止";
  }
  if (payload.state === "processing") {
    return "正在转写并整理文本";
  }
  return payload.status;
}

function stateLabel(state: RuntimeState) {
  if (state === "recording") return "正在录音";
  if (state === "processing") return "转写中";
  if (state === "inserted") return "已插入";
  if (state === "error") return "出错";
  return "待命";
}

function formatElapsed(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}
