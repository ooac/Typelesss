import { AlertTriangle } from "lucide-react";
import { useApp } from "../state/AppContext.js";

export function ErrorBanner() {
  const {
    error,
    shouldShowInputMonitoringAction,
    shouldShowAccessibilityAction,
    openInputMonitoringSettings,
    openAccessibilitySettings,
    installToApplicationsAndOpenPermission,
  } = useApp();
  if (!error) return null;
  return (
    <section className="error-panel" role="alert">
      <AlertTriangle size={18} />
      <span>{error}</span>
      {shouldShowInputMonitoringAction ? (
        <>
          <button
            type="button"
            className="inline-action"
            onClick={installToApplicationsAndOpenPermission}
          >
            安装并打开授权
          </button>
          <button type="button" className="inline-action" onClick={openInputMonitoringSettings}>
            只打开授权页
          </button>
        </>
      ) : null}
      {shouldShowAccessibilityAction ? (
        <button type="button" className="inline-action" onClick={openAccessibilitySettings}>
          打开辅助功能授权
        </button>
      ) : null}
    </section>
  );
}
