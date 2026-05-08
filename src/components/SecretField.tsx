import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useState } from "react";

interface SecretFieldProps {
  label: string;
  value: string;
  hasSavedSecret: boolean;
  onChange: (value: string) => void;
  placeholder?: string;
}

/**
 * Secret input that shows "已保存 ✓" when keychain holds a value but the in-memory
 * config is empty. User must click "编辑" to clear and type a new value.
 */
export function SecretField({
  label,
  value,
  hasSavedSecret,
  onChange,
  placeholder,
}: SecretFieldProps) {
  const [editing, setEditing] = useState(value.length > 0);
  const [reveal, setReveal] = useState(false);

  const showSavedBadge = hasSavedSecret && !editing && value.length === 0;

  return (
    <label className="secret-field">
      <span className="secret-field__label">{label}</span>
      {showSavedBadge ? (
        <div className="secret-field__saved">
          <span className="secret-field__mask">••••••••••</span>
          <span className="health-chip healthy">
            <ShieldCheck size={12} />
            已保存
          </span>
          <button
            type="button"
            className="ghost compact"
            onClick={() => {
              setEditing(true);
              onChange("");
            }}
          >
            编辑
          </button>
        </div>
      ) : (
        <div className="secret-field__editor">
          <input
            type={reveal ? "text" : "password"}
            value={value}
            placeholder={placeholder ?? "粘贴新的密钥"}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => onChange(event.target.value)}
          />
          <button
            type="button"
            className="icon-button"
            aria-label={reveal ? "隐藏" : "显示"}
            onClick={() => setReveal((v) => !v)}
          >
            {reveal ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
          {hasSavedSecret ? (
            <button
              type="button"
              className="ghost compact"
              onClick={() => {
                setEditing(false);
                onChange("");
              }}
            >
              保留原值
            </button>
          ) : null}
        </div>
      )}
    </label>
  );
}
