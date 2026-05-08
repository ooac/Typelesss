import { ChevronDown, Eraser } from "lucide-react";
import { useCallback, useState } from "react";
import { InlineCapsulePreview } from "../components/InlineCapsulePreview.js";
import { ProviderEditor } from "../components/ProviderEditor.js";
import { TranscriptCard, type CardStatus } from "../components/TranscriptCard.js";
import { WaveDots } from "../components/WaveDots.js";
import { useApp } from "../state/AppContext.js";

type SegmentId = "raw" | "normalized" | "final";

const SEGMENTS: Array<{ id: SegmentId; label: string }> = [
  { id: "raw", label: "ASR 原文" },
  { id: "normalized", label: "快速规范化" },
  { id: "final", label: "最终文本" },
];

export function RealtimePage() {
  const { state, rawText, normalizedText, finalText, clearTranscript } = useApp();
  // The active segment is purely a visual focus indicator on the tab bar,
  // not a content gate — all 3 cards render simultaneously.
  const [active, setActive] = useState<SegmentId>("final");
  const [autoScroll, setAutoScroll] = useState(true);

  const onSegmentClick = useCallback((id: SegmentId) => {
    setActive(id);
    const el = document.querySelector<HTMLElement>(`[data-segment="${id}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  const rawStatus: CardStatus =
    state === "recording" || state === "processing" ? "auto-detect" : "idle";
  const normalizedStatus: CardStatus =
    state === "recording" || state === "processing" ? "auto-detect" : "idle";
  const finalStatus: CardStatus = state === "inserted" ? "ready" : "idle";

  const isRecording = state === "recording";

  return (
    <section className="page page-realtime">
      <div className="realtime-main">
        <article className="transcript-panel">
          <header className="section-header">
            <div className="section-header__main">
              <h2>实时输入</h2>
              <WaveDots count={10} active={isRecording} />
            </div>
            <div className="section-header__actions">
              <button
                type="button"
                className="ghost compact dropdown-button"
                onClick={() => setAutoScroll((v) => !v)}
                aria-pressed={autoScroll}
                title="文本变化时自动滚动到底部"
              >
                {autoScroll ? "自动滚动" : "停止滚动"}
                <ChevronDown size={14} />
              </button>
              <button
                type="button"
                className="ghost compact"
                onClick={clearTranscript}
                title="清空所有段的文本"
              >
                <Eraser size={14} />
                清空
              </button>
            </div>
          </header>

          <div className="segment-tabs" role="tablist">
            {SEGMENTS.map((s) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={active === s.id}
                className={`segment-tab ${active === s.id ? "active" : ""}`}
                onClick={() => onSegmentClick(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="transcript-stack">
            <TranscriptCard
              data-segment="raw"
              label="ASR 原文"
              value={rawText}
              status={rawStatus}
              autoScroll={autoScroll}
            />
            <TranscriptCard
              data-segment="normalized"
              label="快速规范化"
              value={normalizedText}
              status={normalizedStatus}
              autoScroll={autoScroll}
            />
            <TranscriptCard
              data-segment="final"
              label="最终文本"
              value={finalText}
              status={finalStatus}
              strong
              autoScroll={autoScroll}
            />
          </div>
        </article>

        <InlineCapsulePreview />
      </div>

      <aside className="inspector">
        <h2>服务商与状态</h2>
        <div className="inspector__list">
          <ProviderEditor showRefresh={false} showAutoInsertRow={false} />
        </div>
      </aside>
    </section>
  );
}
