import { Keyboard, Save, Settings } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import {
  localHybridDefaults,
  stepfunRealtimeDefaults,
  whisperCompatibleDefaults,
} from "./appDefaults.js";
import type { AppConfig, AsrProvider, PolishProvider } from "./appTypes.js";
import { formatHotkey, hotkeyFromKeyboardInput } from "./hotkey.js";
import type { DictationMode } from "./types.js";

interface SettingsFormProps {
  config: AppConfig;
  setConfig: (config: AppConfig) => void;
  onSave: () => void;
  onOpenInputMonitoringSettings: () => void;
  onOpenAccessibilitySettings: () => void;
  onInstallToApplicationsAndOpenPermission: () => void;
  onHotkeyCaptureChange: (isCapturing: boolean) => void;
}

export function SettingsForm({
  config,
  setConfig,
  onSave,
  onOpenInputMonitoringSettings,
  onOpenAccessibilitySettings,
  onInstallToApplicationsAndOpenPermission,
  onHotkeyCaptureChange,
}: SettingsFormProps) {
  const [isCapturingHotkey, setIsCapturingHotkey] = useState(false);
  const update = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) =>
    setConfig({ ...config, [key]: value });
  const updateAsrProvider = (provider: AsrProvider) => {
    if (provider === "local_hybrid") {
      setConfig({
        ...config,
        asrProvider: provider,
        asrEndpoint: localHybridDefaults.endpoint,
        asrModel: localHybridDefaults.model,
      });
      return;
    }
    if (provider === "stepfun_streaming") {
      setConfig({
        ...config,
        asrProvider: provider,
        asrEndpoint: stepfunRealtimeDefaults.endpoint,
        asrModel: stepfunRealtimeDefaults.model,
      });
      return;
    }
    if (provider === "whisper_compatible") {
      setConfig({
        ...config,
        asrProvider: provider,
        asrEndpoint: whisperCompatibleDefaults.endpoint,
        asrModel: whisperCompatibleDefaults.model,
      });
      return;
    }
    update("asrProvider", provider);
  };
  const setHotkeyCapture = (isCapturing: boolean) => {
    setIsCapturingHotkey(isCapturing);
    onHotkeyCaptureChange(isCapturing);
  };

  const captureHotkey = (event: KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") {
      setHotkeyCapture(false);
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      update("hotkey", "");
      return;
    }

    const nextHotkey = hotkeyFromKeyboardEvent(event);
    if (!nextHotkey) {
      return;
    }

    update("hotkey", nextHotkey);
    setHotkeyCapture(false);
    event.currentTarget.blur();
  };

  return (
    <div className="settings-form">
      <label>
        ASR 服务商
        <select value={config.asrProvider} onChange={(event) => updateAsrProvider(event.target.value as AsrProvider)}>
          <option value="local_hybrid">本地混合 ASR</option>
          <option value="stepfun_streaming">StepFun 实时 ASR</option>
          <option value="whisper_compatible">硅基流动 / Whisper-compatible</option>
          <option value="volcengine">Volcengine streaming（配置预留）</option>
        </select>
      </label>
      {config.asrProvider !== "local_hybrid" ? (
        <>
          <label>
            ASR 接口
            <input value={config.asrEndpoint} onChange={(event) => update("asrEndpoint", event.target.value)} />
          </label>
          <label>
            ASR API Key
            <input type="password" value={config.asrApiKey} onChange={(event) => update("asrApiKey", event.target.value)} />
          </label>
          <label>
            ASR 模型
            <input value={config.asrModel} onChange={(event) => update("asrModel", event.target.value)} />
          </label>
        </>
      ) : null}
      <label>
        Volcengine 应用 ID
        <input value={config.volcengineAppId} onChange={(event) => update("volcengineAppId", event.target.value)} />
      </label>
      <label>
        Volcengine 资源 ID
        <input value={config.volcengineResourceId} onChange={(event) => update("volcengineResourceId", event.target.value)} />
      </label>
      <label>
        Volcengine 访问令牌
        <input
          type="password"
          value={config.volcengineAccessToken}
          onChange={(event) => update("volcengineAccessToken", event.target.value)}
        />
      </label>
      <label>
        润色服务商
        <select value={config.polishProvider} onChange={(event) => update("polishProvider", event.target.value as PolishProvider)}>
          <option value="openai_compatible">DeepSeek / OpenAI-compatible</option>
          <option value="disabled">禁用润色</option>
        </select>
      </label>
      <label>
        润色接口
        <input value={config.polishEndpoint} onChange={(event) => update("polishEndpoint", event.target.value)} />
      </label>
      <label>
        润色 API Key
        <input type="password" value={config.polishApiKey} onChange={(event) => update("polishApiKey", event.target.value)} />
      </label>
      <label>
        润色模型
        <input value={config.polishModel} onChange={(event) => update("polishModel", event.target.value)} />
      </label>
      <label>
        输出模式
        <select value={config.outputMode} onChange={(event) => update("outputMode", event.target.value as DictationMode)}>
          <option value="fast_dictation">快速听写</option>
          <option value="smart_polish">智能润色</option>
          <option value="prompt_builder">提示词构建</option>
          <option value="code_prompt">代码提示词</option>
        </select>
      </label>
      <label>
        全局快捷键
        <div className={isCapturingHotkey ? "hotkey-recorder active" : "hotkey-recorder"}>
          <Keyboard size={16} />
          <input
            readOnly
            value={isCapturingHotkey ? "请按下新的快捷键" : formatHotkey(config.hotkey)}
            placeholder="点击后按快捷键"
            onFocus={() => setHotkeyCapture(true)}
            onClick={() => setHotkeyCapture(true)}
            onBlur={() => setHotkeyCapture(false)}
            onKeyDown={captureHotkey}
          />
        </div>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={config.autoInsert} onChange={(event) => update("autoInsert", event.target.checked)} />
        自动粘贴到当前光标
      </label>
      <button className="primary save" onClick={onSave}>
        <Save size={18} />
        保存设置
      </button>
      <button className="ghost permission-button" onClick={onOpenInputMonitoringSettings}>
        <Settings size={17} />
        打开输入监控授权
      </button>
      <button className="ghost permission-button" onClick={onOpenAccessibilitySettings}>
        <Settings size={17} />
        打开辅助功能授权
      </button>
      <button className="ghost permission-button" onClick={onInstallToApplicationsAndOpenPermission}>
        <Settings size={17} />
        安装到应用程序并打开授权
      </button>
      <p className="security-note">API key 会保存到 macOS Keychain，配置文件只保留 endpoint、model 等非敏感字段。</p>
    </div>
  );
}

function hotkeyFromKeyboardEvent(event: KeyboardEvent<HTMLInputElement>) {
  return hotkeyFromKeyboardInput({
    key: event.key,
    code: event.code,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
  });
}
