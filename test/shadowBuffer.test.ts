import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ShadowBuffer, applyTextPatch } from "../src/index.js";

describe("ShadowBuffer", () => {
  it("支持 preview 到 final 的原地替换", () => {
    const buffer = new ShadowBuffer("s1", "前缀：");

    const preview = buffer.updatePreview("我想让 cloud code");
    assert.equal(applyTextPatch("前缀：", preview), "前缀：我想让 cloud code");
    assert.equal(buffer.snapshot().currentText, "前缀：我想让 cloud code");

    const final = buffer.finalReplace("我想让 Claude Code 帮我。");
    assert.equal(buffer.snapshot().currentText, "前缀：我想让 Claude Code 帮我。");
    assert.equal(final.kind, "final");
    assert.equal(buffer.snapshot().active, false);
  });

  it("Esc rollback 只撤销本次输入，不破坏原始文本", () => {
    const buffer = new ShadowBuffer("s1", "已有文本");

    buffer.updatePreview(" OpenLess partial");
    const patch = buffer.rollback();

    assert.equal(patch.kind, "rollback");
    assert.equal(buffer.snapshot().currentText, "已有文本");
    assert.equal(buffer.snapshot().active, false);
  });
});
