import { Plus } from "lucide-react";
import { useMemo } from "react";
import { PresetCard } from "../components/PresetCard.js";
import { makePresetId } from "../appDefaults.js";
import type { Preset } from "../appTypes.js";
import { useApp } from "../state/AppContext.js";

const MAX_PRESETS = 4;

export function HotkeyPage() {
  const { config, updateAndSaveConfig } = useApp();
  const presets = config.presets;

  const updatePreset = (id: string, patch: Partial<Preset>) => {
    const nextPresets = presets.map((p) => (p.id === id ? { ...p, ...patch } : p));
    void updateAndSaveConfig({ presets: nextPresets });
  };

  const activatePreset = (id: string) => {
    void updateAndSaveConfig({ activePresetId: id });
  };

  const deletePreset = (id: string) => {
    if (presets.length <= 1) return;
    const nextPresets = presets.filter((p) => p.id !== id);
    const nextActive =
      config.activePresetId === id ? nextPresets[0]?.id ?? "default" : config.activePresetId;
    void updateAndSaveConfig({ presets: nextPresets, activePresetId: nextActive });
  };

  const addPreset = () => {
    if (presets.length >= MAX_PRESETS) return;
    const newPreset: Preset = {
      id: makePresetId(),
      label: `预设 ${presets.length + 1}`,
      hotkey: "",
      outputMode: "smart_polish",
    };
    void updateAndSaveConfig({ presets: [...presets, newPreset] });
  };

  const duplicateHotkey = useMemo(() => {
    const counts = new Map<string, number>();
    presets.forEach((p) => {
      const key = p.hotkey.trim();
      if (!key) return;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return [...counts.entries()].find(([, n]) => n > 1)?.[0] ?? null;
  }, [presets]);

  return (
    <section className="page page-hotkey">
      <header className="page-header">
        <span className="section-kicker">快捷键</span>
        <h1>快捷键预设</h1>
        <p className="page-description">
          每套预设绑定独立的快捷键和输出模式。按下不同热键时，会自动用对应预设的输出模式处理录音。
        </p>
      </header>

      <div className="preset-list">
        {presets.map((preset) => (
          <PresetCard
            key={preset.id}
            preset={preset}
            isActive={preset.id === config.activePresetId}
            canDelete={presets.length > 1}
            onUpdate={(patch) => updatePreset(preset.id, patch)}
            onActivate={() => activatePreset(preset.id)}
            onDelete={() => deletePreset(preset.id)}
          />
        ))}
      </div>

      {duplicateHotkey ? (
        <div className="error-panel" role="alert">
          <span>快捷键 {duplicateHotkey} 被多个预设占用，请改一个，否则保存会失败。</span>
        </div>
      ) : null}

      {presets.length < MAX_PRESETS ? (
        <button type="button" className="ghost compact preset-add-button" onClick={addPreset}>
          <Plus size={14} />
          添加预设
        </button>
      ) : (
        <p className="page-note">已达到最大预设数量（{MAX_PRESETS}）。</p>
      )}
    </section>
  );
}
