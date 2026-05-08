import { invoke } from "@tauri-apps/api/core";
import { Accessibility, Keyboard, Mic, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PermissionCard } from "../components/PermissionCard.js";
import type { PermissionStatus } from "../appTypes.js";
import { useApp } from "../state/AppContext.js";

const DEFAULT_STATUS: PermissionStatus = {
  microphone: "unknown",
  inputMonitoring: "unknown",
  accessibility: "unknown",
};

export function PermissionsPage() {
  const {
    isTauriRuntime,
    openInputMonitoringSettings,
    openAccessibilitySettings,
    installToApplicationsAndOpenPermission,
  } = useApp();

  const [perms, setPerms] = useState<PermissionStatus>(DEFAULT_STATUS);
  const [micTestResult, setMicTestResult] = useState<string>("");
  const [testing, setTesting] = useState(false);

  const refresh = useCallback(async () => {
    if (!isTauriRuntime) return;
    try {
      const next = await invoke<PermissionStatus>("check_permissions");
      setPerms(next);
    } catch (err) {
      console.warn("check_permissions failed:", err);
    }
  }, [isTauriRuntime]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const runMicTest = async () => {
    if (!isTauriRuntime) {
      setMicTestResult("浏览器预览模式不支持。");
      return;
    }
    setTesting(true);
    setMicTestResult("正在录制 0.5 秒…");
    try {
      const peak = await invoke<number>("test_microphone");
      const peakPercent = Math.round(peak * 100);
      if (peak > 0.001) {
        setMicTestResult(`检测到音频信号，峰值 ${peakPercent}%。麦克风工作正常。`);
        setPerms((prev) => ({ ...prev, microphone: "granted" }));
      } else {
        setMicTestResult("没有检测到音频信号。可能未授权或麦克风被静音。");
        setPerms((prev) => ({ ...prev, microphone: "denied" }));
      }
    } catch (err) {
      setMicTestResult(`测试失败：${String(err)}`);
      setPerms((prev) => ({ ...prev, microphone: "denied" }));
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="page page-permissions">
      <header className="page-header">
        <span className="section-kicker">权限</span>
        <h1>系统授权</h1>
        <p className="page-description">
          Typelesss 需要以下系统权限。状态每 5 秒自动检测一次，也可以点击右上角刷新。
        </p>
      </header>

      <div className="providers-toolbar">
        <button type="button" className="ghost compact" onClick={() => void refresh()}>
          <RefreshCcw size={14} />
          重新检测
        </button>
      </div>

      <div className="permissions-grid">
        <PermissionCard
          icon={<Mic size={22} />}
          title="麦克风"
          description="用于录音并发送给 ASR 服务转写。首次录音 macOS 会主动请求授权。"
          status={perms.microphone}
          detail={micTestResult || undefined}
          actions={
            <button
              type="button"
              className="ghost compact"
              onClick={() => void runMicTest()}
              disabled={testing}
            >
              {testing ? "测试中…" : "测试录音"}
            </button>
          }
        />

        <PermissionCard
          icon={<Keyboard size={22} />}
          title="输入监控"
          description="用于监听 Right Option 等单键全局快捷键。需要在系统设置 → 隐私与安全性中授权。"
          status={perms.inputMonitoring}
          actions={
            <>
              <button
                type="button"
                className="ghost compact"
                onClick={openInputMonitoringSettings}
              >
                打开授权页
              </button>
              <button
                type="button"
                className="ghost compact"
                onClick={installToApplicationsAndOpenPermission}
              >
                安装并授权
              </button>
            </>
          }
        />

        <PermissionCard
          icon={<Accessibility size={22} />}
          title="辅助功能"
          description="用于把文本插入到当前光标位置。未授权时会自动降级为剪贴板。"
          status={perms.accessibility}
          actions={
            <button type="button" className="ghost compact" onClick={openAccessibilitySettings}>
              打开授权页
            </button>
          }
        />
      </div>
    </section>
  );
}
