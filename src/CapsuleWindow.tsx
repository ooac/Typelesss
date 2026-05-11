import { LogicalSize } from "@tauri-apps/api/dpi";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { CapsulePayload, CapsuleSize } from "./appTypes.js";
import {
  CapsuleActivityMeter,
  CapsuleStateIcon,
  capsuleDisplayLabel,
  getCapsuleDisplaySize,
} from "./components/CapsuleVisuals.js";

const SIZE_MAP: Record<CapsuleSize, { width: number; height: number }> = {
  large: { width: 320, height: 64 },
  medium: { width: 230, height: 52 },
  small: { width: 44, height: 44 },
};

export function CapsuleWindow() {
  const isTauriRuntime =
    typeof window !== "undefined" &&
    typeof (window as { __TAURI_INTERNALS__?: { transformCallback?: unknown } }).__TAURI_INTERNALS__
      ?.transformCallback === "function";
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
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
    if (!isTauriRuntime) return undefined;
    const unlisten = listen<CapsulePayload>("capsule-state", (event) => {
      setPayload(event.payload);
    });
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, [isTauriRuntime]);

  const elapsed = payload.startedAt ? Math.max(0, now - payload.startedAt) : 0;
  const elapsedText = formatElapsed(elapsed);
  const shouldShowElapsed = payload.state === "recording";
  const detailText = capsuleDetailText(payload);
  const displaySize = getCapsuleDisplaySize(payload.capsuleSize, payload.state);

  useEffect(() => {
    if (!isTauriRuntime) return;
    const { width, height } = SIZE_MAP[displaySize];
    const win = getCurrentWindow();
    void win.setMinSize(new LogicalSize(44, 44)).catch(() => undefined);
    void win.setSize(new LogicalSize(width, height)).catch(() => undefined);
  }, [displaySize, isTauriRuntime]);

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!isTauriRuntime) return;
    if (event.button !== 0) return;
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
  };
  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!isTauriRuntime) return;
    const start = pointerStartRef.current;
    if (!start) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved < 4) return;
    pointerStartRef.current = null;
    void getCurrentWindow().startDragging();
  };
  const handlePointerUp = () => {
    if (!isTauriRuntime) return;
    if (!pointerStartRef.current) return;
    pointerStartRef.current = null;
    void emit("capsule-toggle-request");
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!isTauriRuntime) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    void emit("capsule-toggle-request");
  };

  return (
    <main
      className={`floating-capsule floating-capsule--${displaySize} ${payload.state}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        pointerStartRef.current = null;
      }}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label="切换录音"
    >
      <div className="capsule-core">
        <div className="capsule-orb" aria-hidden="true">
          <CapsuleStateIcon state={payload.state} />
        </div>
        <div className="capsule-copy">
          <div className="capsule-topline">
            <span>{capsuleDisplayLabel(payload.state, payload.previewText || payload.status)}</span>
            {shouldShowElapsed ? <strong>{elapsedText}</strong> : null}
          </div>
          <p>{detailText}</p>
        </div>
        <CapsuleActivityMeter state={payload.state} />
      </div>
    </main>
  );
}

function capsuleDetailText(payload: CapsulePayload) {
  if (payload.state === "error") {
    return payload.status;
  }
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

function formatElapsed(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}
