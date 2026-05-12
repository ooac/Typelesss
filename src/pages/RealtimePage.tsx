import { ChevronDown, Eraser, Lightbulb } from "lucide-react";
import { useState } from "react";
import { InlineCapsulePreview } from "../components/InlineCapsulePreview.js";
import { ProviderEditor } from "../components/ProviderEditor.js";
import { TranscriptCard, type CardStatus } from "../components/TranscriptCard.js";
import { WaveDots } from "../components/WaveDots.js";
import { useApp } from "../state/AppContext.js";

export function RealtimePage() {
  const { state, finalText, clearTranscript, learnSelectedText } = useApp();
  const [autoScroll, setAutoScroll] = useState(true);
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
                onClick={() => void learnSelectedText()}
                title="把当前目标软件中的选中文本学习为个人术语或纠错"
              >
                <Lightbulb size={14} />
                学习选中文本
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

          <div className="transcript-stack">
            <TranscriptCard
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
