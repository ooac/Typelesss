import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  characterErrorRate,
  LatencyTracker,
  termRecall,
  validatePolishOutput,
  wordErrorRate,
} from "../src/index.js";

describe("OutputValidator", () => {
  it("拒绝回答问题而不是改写输入", () => {
    const result = validatePolishOutput(
      "OpenLess 现在还缺什么功能？",
      "OpenLess 现在还缺以下功能：实时 partial、ShadowBuffer 和 benchmark。",
    );

    assert.equal(result.ok, false);
    assert.equal(result.reason, "answered_instead_of_rewrite");
    assert.equal(result.fallbackText, "OpenLess 现在还缺什么功能？");
  });

  it("拒绝丢失关键术语的输出", () => {
    const result = validatePolishOutput(
      "请检查 OpenLess 的 ShadowBuffer。",
      "请检查这个缓冲区。",
    );

    assert.equal(result.ok, false);
    assert.match(result.reason ?? "", /critical_terms_lost/);
  });
});

describe("Telemetry and benchmark metrics", () => {
  it("计算核心延迟指标", () => {
    const tracker = new LatencyTracker();
    tracker.mark("hotkeyDown", 1000);
    tracker.mark("micStarted", 1040);
    tracker.mark("firstPartial", 1260);
    tracker.mark("hotkeyUp", 3000);
    tracker.mark("asrFinal", 3420);
    tracker.mark("insertStarted", 3430);
    tracker.mark("insertDone", 3500);

    assert.deepEqual(tracker.snapshot(), {
      hotkeyDown: 1000,
      micStarted: 1040,
      firstPartial: 1260,
      hotkeyUp: 3000,
      asrFinal: 3420,
      insertStarted: 3430,
      insertDone: 3500,
      hotkeyToMicMs: 40,
      hotkeyToFirstPartialMs: 260,
      firstStableMs: undefined,
      releaseToFinalMs: 420,
      insertLatencyMs: 70,
      totalMs: 2500,
    });
  });

  it("计算 CER/WER/术语召回", () => {
    assert.equal(characterErrorRate("abc", "abc"), 0);
    assert.equal(wordErrorRate("hello world", "hello there"), 0.5);
    assert.equal(termRecall(["OpenLess", "Claude Code"], "OpenLess uses Claude Code"), 1);
  });
});
