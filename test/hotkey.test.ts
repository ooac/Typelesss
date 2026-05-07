import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatHotkey, hotkeyFromKeyboardInput } from "../src/hotkey.js";

const baseEvent = {
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
};

describe("Hotkey recorder", () => {
  it("识别右侧 Option 纯修饰键", () => {
    assert.equal(hotkeyFromKeyboardInput({ ...baseEvent, key: "Alt", code: "AltRight", altKey: true }), "RightOption");
    assert.equal(formatHotkey("RightOption"), "Right Option");
  });

  it("继续支持普通单键和组合键", () => {
    assert.equal(hotkeyFromKeyboardInput({ ...baseEvent, key: "d", code: "KeyD" }), "D");
    assert.equal(hotkeyFromKeyboardInput({ ...baseEvent, key: " ", code: "Space", altKey: true }), "Option+Space");
  });
});
