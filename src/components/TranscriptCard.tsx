import { CheckCircle2 } from "lucide-react";
import { Fragment, useEffect, useRef } from "react";

export type CardStatus = "auto-detect" | "ready" | "idle";

interface TranscriptCardProps {
  label: string;
  value: string;
  status?: CardStatus;
  strong?: boolean;
  autoScroll?: boolean;
  /** segment anchor id for scrollIntoView */
  "data-segment"?: string;
}

const STATUS_LABEL: Record<CardStatus, string | null> = {
  "auto-detect": "自动检测",
  ready: "已就绪",
  idle: null,
};

export function TranscriptCard({
  label,
  value,
  status = "idle",
  strong = false,
  autoScroll = true,
  "data-segment": dataSegment,
}: TranscriptCardProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const placeholder = "等待内容。";
  const lines = value ? value.split("\n") : [placeholder];
  // pad to at least 3 lines so empty state mirrors the reference layout
  const padded =
    lines.length < 3 ? [...lines, ...Array(3 - lines.length).fill("")] : lines;
  const statusLabel = STATUS_LABEL[status];

  useEffect(() => {
    if (!autoScroll) return;
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [value, autoScroll]);

  return (
    <div
      className={`transcript-card ${strong ? "strong" : ""}`}
      data-segment={dataSegment}
    >
      <header className="transcript-card__header">
        <span className="transcript-card__label">{label}</span>
        <span className="transcript-card__count">{value.length} 字符</span>
      </header>
      <div className="transcript-card__body" ref={bodyRef}>
        <div className="line-grid">
          {padded.map((line, i) => (
            <Fragment key={i}>
              <span className="line-num">{i + 1}</span>
              <span className="line-text">{line || " "}</span>
            </Fragment>
          ))}
        </div>
      </div>
      {statusLabel ? (
        <footer className="transcript-card__footer">
          <span className={`status-chip ${status === "ready" ? "ok" : ""}`}>
            {statusLabel}
            <CheckCircle2 size={12} />
          </span>
        </footer>
      ) : null}
    </div>
  );
}
