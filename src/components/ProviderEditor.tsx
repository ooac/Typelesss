import {
  CloudCog,
  Cpu,
  Database,
  Key,
  Link2,
  RefreshCcw,
  Sparkles,
  Wand2,
  Wrench,
} from "lucide-react";
import { useState } from "react";
import { Drawer } from "./Drawer.js";
import { HealthChip } from "./HealthChip.js";
import { ProviderRow } from "./ProviderRow.js";
import { SecretField } from "./SecretField.js";
import { useHealth } from "../health/HealthContext.js";
import { useApp } from "../state/AppContext.js";
import type { AppConfig, AsrProvider, PolishProvider } from "../appTypes.js";
import type { DictationMode } from "../types.js";

type EditorId =
  | "asrProvider"
  | "asrModel"
  | "asrEndpoint"
  | "asrApiKey"
  | "volcengine"
  | "polishProvider"
  | "polishEndpoint"
  | "polishApiKey"
  | "polishModel"
  | "outputMode";

const ASR_PROVIDER_LABEL: Record<AsrProvider, string> = {
  whisper_compatible: "硅基流动 / Whisper-compatible",
  volcengine: "Volcengine streaming",
};

const POLISH_PROVIDER_LABEL: Record<PolishProvider, string> = {
  openai_compatible: "DeepSeek / OpenAI-compatible",
  disabled: "已禁用",
};

const OUTPUT_MODE_LABEL: Record<DictationMode, string> = {
  fast_dictation: "快速听写",
  smart_polish: "智能润色",
  prompt_builder: "提示词构建",
  code_prompt: "代码提示词",
};

interface ProviderEditorProps {
  showRefresh?: boolean;
  showAutoInsertRow?: boolean;
}

/**
 * Reusable list of provider/config rows + drawer editor.
 * Used by both ProvidersPage (full page) and RealtimePage's right inspector.
 */
export function ProviderEditor({
  showRefresh = true,
  showAutoInsertRow = true,
}: ProviderEditorProps) {
  const { config, setConfig, updateAndSaveConfig } = useApp();
  const { asr, polish, secrets, refresh, loading } = useHealth();
  const [editing, setEditing] = useState<EditorId | null>(null);
  const [draft, setDraft] = useState<AppConfig>(config);

  const openEditor = (id: EditorId) => {
    setDraft(config);
    setEditing(id);
  };
  const closeEditor = () => setEditing(null);
  const saveAndClose = async () => {
    await updateAndSaveConfig(diffPatch(config, draft));
    closeEditor();
  };

  const isAsrVolcengine = config.asrProvider === "volcengine";
  const draftAsrIsVolcengine = draft.asrProvider === "volcengine";

  return (
    <>
      {showRefresh ? (
        <div className="providers-toolbar">
          <button
            type="button"
            className="ghost compact"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCcw size={14} />
            {loading ? "探测中…" : "立即探测"}
          </button>
        </div>
      ) : null}

      <div className="section-label">ASR · 语音转写</div>
      <ProviderRow
        icon={<CloudCog size={16} />}
        label="ASR 服务商"
        value={ASR_PROVIDER_LABEL[config.asrProvider] ?? config.asrProvider}
        onClick={() => openEditor("asrProvider")}
      />
      {isAsrVolcengine ? (
        <ProviderRow
          icon={<Database size={16} />}
          label="Volcengine 凭证"
          value={config.volcengineAppId ? `App ID ${config.volcengineAppId}` : "未配置"}
          status={<HealthChip probe={asr} />}
          onClick={() => openEditor("volcengine")}
        />
      ) : (
        <>
          <ProviderRow
            icon={<Cpu size={16} />}
            label="ASR 模型"
            value={config.asrModel || "未配置"}
            onClick={() => openEditor("asrModel")}
          />
          <ProviderRow
            icon={<Link2 size={16} />}
            label="ASR 接口"
            value={truncateUrl(config.asrEndpoint)}
            status={<HealthChip probe={asr} />}
            onClick={() => openEditor("asrEndpoint")}
          />
          <ProviderRow
            icon={<Key size={16} />}
            label="ASR API Key"
            value={secrets.asrApiKey ? "已保存" : "未配置"}
            status={
              secrets.asrApiKey ? <span className="status-chip saved">已保存</span> : null
            }
            onClick={() => openEditor("asrApiKey")}
          />
        </>
      )}

      <div className="section-label">润色 · LLM</div>
      <ProviderRow
        icon={<Wand2 size={16} />}
        label="润色服务商"
        value={POLISH_PROVIDER_LABEL[config.polishProvider] ?? config.polishProvider}
        onClick={() => openEditor("polishProvider")}
      />
      {config.polishProvider !== "disabled" ? (
        <>
          <ProviderRow
            icon={<Cpu size={16} />}
            label="润色模型"
            value={config.polishModel || "未配置"}
            onClick={() => openEditor("polishModel")}
          />
          <ProviderRow
            icon={<Link2 size={16} />}
            label="润色接口"
            value={truncateUrl(config.polishEndpoint)}
            status={<HealthChip probe={polish} />}
            onClick={() => openEditor("polishEndpoint")}
          />
          <ProviderRow
            icon={<Key size={16} />}
            label="润色 API Key"
            value={secrets.polishApiKey ? "已保存" : "未配置"}
            status={
              secrets.polishApiKey ? <span className="status-chip saved">已保存</span> : null
            }
            onClick={() => openEditor("polishApiKey")}
          />
        </>
      ) : null}

      <div className="section-label">输出</div>
      <ProviderRow
        icon={<Sparkles size={16} />}
        label="输出模式"
        value={OUTPUT_MODE_LABEL[config.outputMode] ?? config.outputMode}
        onClick={() => openEditor("outputMode")}
      />
      {showAutoInsertRow ? (
        <div className="provider-row is-static provider-row--inline">
          <span className="provider-row__icon">
            <Wrench size={16} />
          </span>
          <div className="provider-row__main">
            <span className="provider-row__label">自动粘贴到当前光标</span>
            <span className="provider-row__value">
              {config.autoInsert ? "开启 — 文本自动粘贴" : "关闭 — 文本仅复制到剪贴板"}
            </span>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={config.autoInsert}
              onChange={(event) => {
                const next = { ...config, autoInsert: event.target.checked };
                setConfig(next);
                void updateAndSaveConfig({ autoInsert: event.target.checked });
              }}
            />
            <span />
          </label>
        </div>
      ) : null}

      <Drawer
        open={editing !== null}
        title={editorTitle(editing)}
        description={editorDescription(editing)}
        onClose={closeEditor}
        footer={
          <>
            <button type="button" className="ghost compact" onClick={closeEditor}>
              取消
            </button>
            <button type="button" className="primary" onClick={() => void saveAndClose()}>
              保存
            </button>
          </>
        }
      >
        {editing === "asrProvider" ? (
          <SelectField
            label="ASR 服务商"
            value={draft.asrProvider}
            options={[
              { value: "whisper_compatible", label: ASR_PROVIDER_LABEL.whisper_compatible },
              { value: "volcengine", label: ASR_PROVIDER_LABEL.volcengine },
            ]}
            onChange={(value) => setDraft({ ...draft, asrProvider: value as AsrProvider })}
          />
        ) : null}

        {editing === "asrModel" ? (
          <TextField
            label="ASR 模型"
            value={draft.asrModel}
            placeholder="FunAudioLLM/SenseVoiceSmall"
            onChange={(value) => setDraft({ ...draft, asrModel: value })}
          />
        ) : null}

        {editing === "asrEndpoint" ? (
          <TextField
            label="ASR 接口"
            value={draft.asrEndpoint}
            placeholder="https://api.siliconflow.cn/v1/audio/transcriptions"
            onChange={(value) => setDraft({ ...draft, asrEndpoint: value })}
          />
        ) : null}

        {editing === "asrApiKey" ? (
          <SecretField
            label="ASR API Key"
            value={draft.asrApiKey}
            hasSavedSecret={secrets.asrApiKey}
            onChange={(value) => setDraft({ ...draft, asrApiKey: value })}
          />
        ) : null}

        {editing === "volcengine" || (draftAsrIsVolcengine && editing === "asrProvider") ? (
          <>
            <TextField
              label="Volcengine App ID"
              value={draft.volcengineAppId}
              onChange={(value) => setDraft({ ...draft, volcengineAppId: value })}
            />
            <TextField
              label="Volcengine Resource ID"
              value={draft.volcengineResourceId}
              onChange={(value) => setDraft({ ...draft, volcengineResourceId: value })}
            />
            <SecretField
              label="Volcengine 访问令牌"
              value={draft.volcengineAccessToken}
              hasSavedSecret={secrets.volcengineAccessToken}
              onChange={(value) => setDraft({ ...draft, volcengineAccessToken: value })}
            />
          </>
        ) : null}

        {editing === "polishProvider" ? (
          <SelectField
            label="润色服务商"
            value={draft.polishProvider}
            options={[
              { value: "openai_compatible", label: POLISH_PROVIDER_LABEL.openai_compatible },
              { value: "disabled", label: POLISH_PROVIDER_LABEL.disabled },
            ]}
            onChange={(value) => setDraft({ ...draft, polishProvider: value as PolishProvider })}
          />
        ) : null}

        {editing === "polishEndpoint" ? (
          <TextField
            label="润色接口"
            value={draft.polishEndpoint}
            placeholder="https://api.deepseek.com/v1"
            onChange={(value) => setDraft({ ...draft, polishEndpoint: value })}
          />
        ) : null}

        {editing === "polishModel" ? (
          <TextField
            label="润色模型"
            value={draft.polishModel}
            placeholder="deepseek-v4-flash"
            onChange={(value) => setDraft({ ...draft, polishModel: value })}
          />
        ) : null}

        {editing === "polishApiKey" ? (
          <SecretField
            label="润色 API Key"
            value={draft.polishApiKey}
            hasSavedSecret={secrets.polishApiKey}
            onChange={(value) => setDraft({ ...draft, polishApiKey: value })}
          />
        ) : null}

        {editing === "outputMode" ? (
          <SelectField
            label="输出模式"
            value={draft.outputMode}
            options={[
              { value: "fast_dictation", label: OUTPUT_MODE_LABEL.fast_dictation },
              { value: "smart_polish", label: OUTPUT_MODE_LABEL.smart_polish },
              { value: "prompt_builder", label: OUTPUT_MODE_LABEL.prompt_builder },
              { value: "code_prompt", label: OUTPUT_MODE_LABEL.code_prompt },
            ]}
            onChange={(value) => setDraft({ ...draft, outputMode: value as DictationMode })}
          />
        ) : null}
      </Drawer>
    </>
  );
}

function TextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="drawer-field">
      <span>{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="drawer-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function editorTitle(id: EditorId | null): string {
  switch (id) {
    case "asrProvider":
      return "选择 ASR 服务商";
    case "asrModel":
      return "ASR 模型";
    case "asrEndpoint":
      return "ASR 接口";
    case "asrApiKey":
      return "ASR API Key";
    case "volcengine":
      return "Volcengine 凭证";
    case "polishProvider":
      return "选择润色服务商";
    case "polishModel":
      return "润色模型";
    case "polishEndpoint":
      return "润色接口";
    case "polishApiKey":
      return "润色 API Key";
    case "outputMode":
      return "输出模式";
    default:
      return "";
  }
}

function editorDescription(id: EditorId | null): string | undefined {
  switch (id) {
    case "asrApiKey":
    case "polishApiKey":
      return "保存后会写入 macOS Keychain，下次启动自动读取，配置文件中只保留占位。";
    case "volcengine":
      return "Volcengine streaming ASR 需要 App ID、Resource ID 和 Access Token 三项。";
    case "outputMode":
      return "决定文本经过哪条整理链路：快速听写跳过润色，智能润色调用 LLM。";
    default:
      return undefined;
  }
}

function diffPatch(current: AppConfig, draft: AppConfig): Partial<AppConfig> {
  const patch: Partial<AppConfig> = {};
  (Object.keys(draft) as Array<keyof AppConfig>).forEach((key) => {
    if (current[key] !== draft[key]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (patch as any)[key] = draft[key];
    }
  });
  return patch;
}

function truncateUrl(url: string): string {
  if (!url) return "未配置";
  if (url.length <= 36) return url;
  return `${url.slice(0, 22)}…${url.slice(-10)}`;
}
