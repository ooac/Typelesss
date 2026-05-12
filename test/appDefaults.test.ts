import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  autoOptimizedDefaults,
  defaultConfig,
  localHybridDefaults,
  mergeLoadedConfig,
  normalizeAsrProviderConfig,
} from "../src/appDefaults.js";
import type { AppConfig } from "../src/appTypes.js";

describe("配置加载合并", () => {
  it("旧配置没有 presets 时保留用户已设置的快捷键", () => {
    const config = mergeLoadedConfig({
      hotkey: "RightOption",
      outputMode: "smart_polish",
      presets: [],
    } as Partial<AppConfig>);

    assert.equal(config.hotkey, "RightOption");
    assert.equal(config.presets[0]?.hotkey, "RightOption");
    assert.equal(config.activePresetId, "default");
  });

  it("已有 presets 时不使用默认快捷键覆盖当前预设", () => {
    const config = mergeLoadedConfig({
      hotkey: "Option+Space",
      activePresetId: "default",
      presets: [
        {
          id: "default",
          label: "默认",
          hotkey: "Command+Shift+Space",
          outputMode: "smart_polish",
        },
      ],
    } as Partial<AppConfig>);

    assert.equal(config.hotkey, "Command+Shift+Space");
    assert.equal(config.presets[0]?.hotkey, "Command+Shift+Space");
  });

  it("本地混合 ASR 默认使用 SenseVoice 且不改快捷键", () => {
    const config = normalizeAsrProviderConfig({
      hotkey: "RightOption",
      asrProvider: "local_hybrid",
      asrEndpoint: "https://example.com",
      asrModel: "qwen3-asr-1.7b",
      localAsrEngineId: "qwen3-asr-1.7b",
    } as AppConfig);

    assert.equal(localHybridDefaults.model, "sensevoice-small");
    assert.equal(config.asrModel, "sensevoice-small");
    assert.equal(config.localAsrEngineId, "sensevoice-small");
    assert.equal(config.hotkey, "RightOption");
  });

  it("默认使用极速自动 ASR 且保留候选顺序", () => {
    assert.equal(defaultConfig.asrProvider, "auto_optimized");
    assert.equal(defaultConfig.asrEndpoint, autoOptimizedDefaults.endpoint);
    assert.equal(defaultConfig.asrModel, autoOptimizedDefaults.model);
    assert.deepEqual(defaultConfig.asrProviderCandidates, autoOptimizedDefaults.candidates);
  });

  it("极速自动 ASR 补齐默认 endpoint/model/candidates 且不改快捷键", () => {
    const config = normalizeAsrProviderConfig({
      hotkey: "RightOption",
      asrProvider: "auto_optimized",
      asrEndpoint: "",
      asrModel: "",
      asrProviderCandidates: [],
    } as unknown as AppConfig);

    assert.equal(config.asrEndpoint, autoOptimizedDefaults.endpoint);
    assert.equal(config.asrModel, autoOptimizedDefaults.model);
    assert.deepEqual(config.asrProviderCandidates, autoOptimizedDefaults.candidates);
    assert.equal(config.hotkey, "RightOption");
  });
});
