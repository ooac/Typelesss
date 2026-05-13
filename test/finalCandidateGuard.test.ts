import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chooseBestTranscript, chooseRealtimeFinalCandidate } from "../src/asr/finalCandidateGuard.js";

describe("FinalCandidateGuard", () => {
  it("实时 final 疑似只剩后半句时使用更长 preview 并要求完整录音复核", () => {
    const decision = chooseRealtimeFinalCandidate(
      "然后去学很多很多的知识。",
      "我今天要出去学习一下，然后去学很多很多的知识。",
      4200,
    );

    assert.equal(decision.text, "我今天要出去学习一下，然后去学很多很多的知识。");
    assert.equal(decision.needsFullAudioReview, true);
    assert.equal(decision.reason, "preview_longer");
  });

  it("纯标点 final 不作为可插入文本", () => {
    const decision = chooseRealtimeFinalCandidate("。", "", 800);

    assert.equal(decision.text, "");
    assert.equal(decision.needsFullAudioReview, true);
    assert.equal(decision.reason, "low_information");
  });

  it("完整录音复核更长时优先使用复核文本", () => {
    const text = chooseBestTranscript("然后去学习。", "我今天要出去学习一下，然后去学习。");

    assert.equal(text, "我今天要出去学习一下，然后去学习。");
  });
});
