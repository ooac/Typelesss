import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TranscriptStabilizer } from "../src/index.js";

describe("TranscriptStabilizer", () => {
  it("从抖动 partial 中只提交安全稳定前缀", () => {
    const stabilizer = new TranscriptStabilizer({ dictionaryTerms: ["Claude Code"] });

    assert.equal(stabilizer.onPartial("我想让 cloud").stableText, "");
    assert.equal(stabilizer.onPartial("我想让 cloud code").stableText, "我想让");
    assert.equal(stabilizer.onPartial("我想让 Claude Code").stableText, "我想让");

    const final = stabilizer.onFinal("我想让 Claude Code 帮我");
    assert.equal(final.stableText, "我想让 Claude Code 帮我");
    assert.equal(final.final, true);
  });

  it("final 会强制提交全部文本", () => {
    const stabilizer = new TranscriptStabilizer();
    stabilizer.onPartial("OpenLess realtime");
    const output = stabilizer.onFinal("OpenLess realtime ASR pipeline");

    assert.equal(output.stableText, "OpenLess realtime ASR pipeline");
    assert.equal(output.previewText, "OpenLess realtime ASR pipeline");
  });
});
