import { AlertTriangle, CheckCircle2, HelpCircle, Power, Slash } from "lucide-react";
import type { ProbeResult } from "../health/probe.js";

interface HealthChipProps {
  probe: ProbeResult | null;
}

export function HealthChip({ probe }: HealthChipProps) {
  if (!probe) {
    return (
      <span className="health-chip">
        <HelpCircle size={12} />
        探测中
      </span>
    );
  }
  switch (probe.status) {
    case "healthy":
      return (
        <span className="health-chip healthy">
          <CheckCircle2 size={12} />
          健康 {probe.latencyMs} ms
        </span>
      );
    case "degraded":
      return (
        <span className="health-chip degraded">
          <AlertTriangle size={12} />
          降级 {probe.latencyMs ? `${probe.latencyMs} ms` : ""}
        </span>
      );
    case "down":
      return (
        <span className="health-chip down">
          <Power size={12} />
          不可达
        </span>
      );
    case "unconfigured":
      return (
        <span className="health-chip">
          <Slash size={12} />
          未配置
        </span>
      );
    case "unknown":
    default:
      return (
        <span className="health-chip">
          <HelpCircle size={12} />
          未知
        </span>
      );
  }
}
