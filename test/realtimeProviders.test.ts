import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isRealtimeAsrProvider, latestRealtimeText } from "../src/asr/realtimeProviders.js";

describe("实时 ASR provider 判断", () => {
  it("直接选择腾讯云实时 ASR 时必须走实时停止流程", () => {
    assert.equal(isRealtimeAsrProvider("tencent_realtime"), true);
  });

  it("硅基流动 batch provider 不走实时停止流程", () => {
    assert.equal(isRealtimeAsrProvider("whisper_compatible"), false);
  });

  it("优先使用最后的实时 final，缺失时使用 preview/stable", () => {
    assert.equal(latestRealtimeText("  最终文本  ", "预览文本"), "最终文本");
    assert.equal(latestRealtimeText("", "  稳定文本  "), "稳定文本");
  });
});
