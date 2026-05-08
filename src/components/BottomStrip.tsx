import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Activity, Clock3, ShieldCheck, Sparkles, Target } from "lucide-react";
import { useHealth } from "../health/HealthContext.js";
import { navigate } from "../router.js";
import { useApp } from "../state/AppContext.js";
import type { PermissionStatus } from "../appTypes.js";

export function BottomStrip() {
  const { recordingElapsed, config, state, isTauriRuntime } = useApp();
  const { asr } = useHealth();
  const ready = state === "idle" || state === "inserted";
  const [perms, setPerms] = useState<PermissionStatus>({
    microphone: "unknown",
    inputMonitoring: "unknown",
    accessibility: "unknown",
  });

  useEffect(() => {
    if (!isTauriRuntime) return undefined;
    const refresh = async () => {
      try {
        const next = await invoke<PermissionStatus>("check_permissions");
        setPerms(next);
      } catch {
        // ignore
      }
    };
    void refresh();
    const id = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(id);
  }, [isTauriRuntime]);

  // Worst-case roll-up: granted only when both input-monitoring and accessibility are granted
  const overallGranted =
    perms.inputMonitoring === "granted" && perms.accessibility === "granted";
  const overallDenied =
    perms.inputMonitoring === "denied" || perms.accessibility === "denied";
  const overallLabel = overallGranted
    ? "已授予"
    : overallDenied
      ? "未授权"
      : "检测中";
  const overallClass = overallGranted ? "ok" : overallDenied ? "danger" : "warn";

  return (
    <footer className="bottom-strip">
      <div className="bottom-strip__cell">
        <ShieldCheck size={14} />
        <span>权限状态：</span>
        <strong className={overallClass}>{overallLabel}</strong>
        <button
          type="button"
          className="bottom-action-button"
          onClick={() => navigate("permissions")}
        >
          检查
        </button>
      </div>
      <div className="bottom-strip__cell">
        <Target size={14} />
        <span>当前插入目标：未检测到活动应用</span>
      </div>
      <div className="bottom-strip__cell tabular">
        <Activity size={14} />
        <span>ASR 延迟：{formatLatency(asr)}</span>
      </div>
      <div className="bottom-strip__cell tabular">
        <Clock3 size={14} />
        <span>录音时长：{recordingElapsed}</span>
      </div>
      <div className="bottom-strip__cell">
        <Sparkles size={14} />
        <span>{config.autoInsert ? "自动粘贴" : "复制到剪贴板"}</span>
      </div>
      <div className={`bottom-strip__ready ${ready ? "is-ready" : "is-busy"}`}>
        <span className="pulse" />
        <span>{ready ? "就绪" : "处理中"}</span>
      </div>
    </footer>
  );
}

function formatLatency(asr: ReturnType<typeof useHealth>["asr"]) {
  if (!asr) return "—";
  if (asr.status === "healthy" && asr.latencyMs != null) return `${asr.latencyMs} ms`;
  if (asr.status === "degraded" && asr.latencyMs != null) return `${asr.latencyMs} ms (降级)`;
  if (asr.status === "down") return "不可达";
  if (asr.status === "unconfigured") return "未配置";
  return "—";
}

