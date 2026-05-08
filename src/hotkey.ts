export interface KeyboardHotkeyInput {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export function formatHotkey(hotkey: string) {
  if (hotkey === "RightOption") return "Right Option";
  return hotkey.replace(/\+/g, " + ");
}

export function hotkeyFromKeyboardInput(event: KeyboardHotkeyInput) {
  const key = normalizeKeyboardKey(event.key, event.code);
  if (key === "RightOption") {
    return key;
  }
  if (!key || isModifierKey(key)) {
    return null;
  }

  const modifiers = [
    event.metaKey ? "Command" : null,
    event.ctrlKey ? "Control" : null,
    event.altKey ? "Option" : null,
    event.shiftKey ? "Shift" : null,
  ].filter(Boolean) as string[];

  if (modifiers.length === 0) {
    return key;
  }

  return [...modifiers, key].join("+");
}

function normalizeKeyboardKey(key: string, code: string) {
  if ((key === "Alt" || key === "Option") && code === "AltRight") return "RightOption";
  if (key === " ") return "Space";
  if (key === "Escape") return "Escape";
  if (key === "Enter") return "Enter";
  if (key === "Tab") return "Tab";
  if (key === "ArrowUp") return "ArrowUp";
  if (key === "ArrowDown") return "ArrowDown";
  if (key === "ArrowLeft") return "ArrowLeft";
  if (key === "ArrowRight") return "ArrowRight";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F\d{1,2}$/.test(key)) return key;
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function isModifierKey(key: string) {
  return ["Meta", "Command", "Control", "Alt", "Option", "Shift"].includes(key);
}
