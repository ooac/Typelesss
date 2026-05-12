import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  inferReadbackCorrection,
  inferSelectedTextCorrection,
} from "../src/correction/learnedCorrection.js";

describe("纠错记忆门禁", () => {
  it("选中文本学习只写入词级纠错", () => {
    assert.deepEqual(
      inferSelectedTextCorrection("我要使用 codeex。", "codex"),
      { beforeText: "codeex", afterText: "codex" },
    );
  });

  it("自动回读从上下文中提取短词纠错", () => {
    assert.deepEqual(
      inferReadbackCorrection("我要使用 codeex。", "我要使用 codex。"),
      { beforeText: "codeex", afterText: "codex" },
    );
  });

  it("拒绝把明显错误的中文片段关联到英文术语", () => {
    assert.equal(inferSelectedTextCorrection("到的。C 的。", "Claude Code"), null);
    assert.equal(inferReadbackCorrection("到的。C 的。", "Claude Code"), null);
  });
});
