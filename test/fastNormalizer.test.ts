import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeFast } from "../src/index.js";

describe("FastNormalizer", () => {
  it("修正中英混输专有名词和空格", () => {
    const result = normalizeFast("我想用 cloud code 和 code X 对比一下 open less 的 realtime asr pipeline。");

    assert.equal(
      result.normalizedText,
      "我想用 Claude Code 和 OpenAI Codex 对比一下 OpenLess 的 realtime ASR pipeline。",
    );
    assert.deepEqual(new Set(result.dictionaryHits), new Set([
      "OpenAI Codex",
      "Claude Code",
      "OpenLess",
      "realtime ASR",
    ]));
    assert.equal(result.languageMode, "mixed");
  });

  it("清理中文口癖并做轻量标点整理", () => {
    const result = normalizeFast("嗯那个我们先不要做太多语言啊，就中文英文还有中英混输，然后重点是速度和准确率。");

    assert.equal(result.normalizedText, "我们先不要做太多语言，只做中文、英文和中英混输。重点是速度和准确率。");
  });

  it("转换英文标点口令和邮件问候格式", () => {
    const result = normalizeFast(
      "hello john comma please review the PRD colon focus on latency comma accuracy comma and correction learning period",
    );

    assert.equal(
      result.normalizedText,
      "Hello John,\n\nPlease review the PRD: focus on latency, accuracy, and correction learning.",
    );
  });

  it("Code Prompt 模式保留代码 token", () => {
    const result = normalizeFast(
      "在 coordinator 里面监听 transcript event，partial 的时候更新 capsule，stable 的时候更新 shadow buffer，final 的时候调用 polish。",
      { mode: "code_prompt" },
    );

    assert.equal(
      result.normalizedText,
      "在 `coordinator` 里面监听 `TranscriptEvent`：\n\n1. `partial` 时更新 `capsule`。\n2. `stable` 时更新 `ShadowBuffer`。\n3. `final` 时调用 polish。",
    );
  });

  it("应用个人记忆词典", () => {
    const result = normalizeFast("以后这里都叫 type less 本地模型。", {
      dictionaryEntries: [
        {
          canonical: "Typeless Local",
          aliases: ["type less 本地模型"],
          category: "product",
          language: "mixed",
        },
      ],
    });

    assert.equal(result.normalizedText, "以后这里都叫 Typeless Local。");
    assert.deepEqual(result.dictionaryHits, ["Typeless Local"]);
  });
});
