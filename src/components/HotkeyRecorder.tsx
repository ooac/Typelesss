import { Keyboard } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { formatHotkey, hotkeyFromKeyboardInput } from "../hotkey.js";
import { useApp } from "../state/AppContext.js";

interface HotkeyRecorderProps {
  hotkey: string;
  onChange: (hotkey: string) => void;
  onCommit?: () => void;
}

export function HotkeyRecorder({ hotkey, onChange, onCommit }: HotkeyRecorderProps) {
  const { setIsHotkeyCapture } = useApp();
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    return () => setIsHotkeyCapture(false);
  }, [setIsHotkeyCapture]);

  const setCapture = (next: boolean) => {
    setCapturing(next);
    setIsHotkeyCapture(next);
  };

  const captureKey = (event: KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setCapture(false);
      return;
    }
    if (event.key === "Backspace" || event.key === "Delete") {
      onChange("");
      return;
    }
    const next = hotkeyFromKeyboardInput({
      key: event.key,
      code: event.code,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
    });
    if (!next) return;
    setCapture(false);
    event.currentTarget.blur();
    onChange(next);
    onCommit?.();
  };

  return (
    <div className={capturing ? "hotkey-recorder active" : "hotkey-recorder"}>
      <Keyboard size={16} />
      <input
        readOnly
        value={capturing ? "请按下新的快捷键" : formatHotkey(hotkey) || "未设置"}
        placeholder="点击后按快捷键"
        onFocus={() => setCapture(true)}
        onClick={() => setCapture(true)}
        onBlur={() => setCapture(false)}
        onKeyDown={captureKey}
      />
    </div>
  );
}
