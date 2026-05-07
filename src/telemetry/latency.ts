export type LatencyMarker =
  | "hotkeyDown"
  | "micStarted"
  | "asrOpened"
  | "firstAudioSent"
  | "firstPartial"
  | "firstStable"
  | "hotkeyUp"
  | "asrFinal"
  | "fastNormalized"
  | "polishStarted"
  | "polishFirstDelta"
  | "polishDone"
  | "insertStarted"
  | "insertDone";

export type LatencyBreakdown = Partial<Record<LatencyMarker, number>> & {
  hotkeyToMicMs?: number;
  hotkeyToFirstPartialMs?: number;
  firstStableMs?: number;
  releaseToFinalMs?: number;
  insertLatencyMs?: number;
  totalMs?: number;
};

export class LatencyTracker {
  private readonly markers: Partial<Record<LatencyMarker, number>> = {};

  mark(marker: LatencyMarker, timestampMs = Date.now()): void {
    this.markers[marker] = timestampMs;
  }

  snapshot(): LatencyBreakdown {
    const m = this.markers;
    return {
      ...m,
      hotkeyToMicMs: diff(m.hotkeyDown, m.micStarted),
      hotkeyToFirstPartialMs: diff(m.hotkeyDown, m.firstPartial),
      firstStableMs: diff(m.hotkeyDown, m.firstStable),
      releaseToFinalMs: diff(m.hotkeyUp, m.asrFinal ?? m.fastNormalized ?? m.polishDone),
      insertLatencyMs: diff(m.insertStarted, m.insertDone),
      totalMs: diff(m.hotkeyDown, m.insertDone),
    };
  }
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index]!;
}

function diff(start?: number, end?: number): number | undefined {
  return start === undefined || end === undefined ? undefined : Math.max(0, end - start);
}
