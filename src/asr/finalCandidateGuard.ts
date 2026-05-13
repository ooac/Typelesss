export interface FinalCandidateDecision {
  text: string;
  needsFullAudioReview: boolean;
  reason: "final_ok" | "preview_longer" | "low_information" | "empty" | "language_mismatch";
}

export function chooseRealtimeFinalCandidate(
  realtimeFinal: string,
  realtimePreview: string,
  durationMs: number,
): FinalCandidateDecision {
  const finalText = realtimeFinal.trim();
  const previewText = realtimePreview.trim();

  if (isUnsupportedLanguage(finalText)) {
    return {
      text: previewText || "",
      needsFullAudioReview: true,
      reason: "language_mismatch",
    };
  }

  if (isLowInformation(finalText)) {
    return {
      text: isLowInformation(previewText) ? "" : previewText,
      needsFullAudioReview: true,
      reason: finalText ? "low_information" : "empty",
    };
  }

  if (isLikelyTruncated(finalText, previewText, durationMs)) {
    return {
      text: previewText,
      needsFullAudioReview: true,
      reason: "preview_longer",
    };
  }

  return {
    text: finalText,
    needsFullAudioReview: false,
    reason: "final_ok",
  };
}

export function chooseBestTranscript(primary: string, reviewed: string): string {
  const first = primary.trim();
  const second = reviewed.trim();
  if (isLowInformation(second) || isUnsupportedLanguage(second)) return first;
  if (isLowInformation(first) || isUnsupportedLanguage(first)) return second;

  const firstMeaningful = meaningfulLength(first);
  const secondMeaningful = meaningfulLength(second);
  if (secondMeaningful >= Math.max(4, Math.ceil(firstMeaningful * 1.12))) return second;

  return first;
}

function isLikelyTruncated(finalText: string, previewText: string, durationMs: number): boolean {
  if (isLowInformation(previewText)) return false;
  const finalMeaningful = meaningfulLength(finalText);
  const previewMeaningful = meaningfulLength(previewText);
  if (previewMeaningful < 10) return false;
  if (finalText === previewText || finalText.startsWith(previewText)) return false;
  if (previewText.endsWith(finalText) && previewMeaningful >= finalMeaningful + 6) return true;
  if (durationMs >= 2500 && finalMeaningful < Math.ceil(previewMeaningful * 0.72)) return true;
  return durationMs >= 5000 && finalMeaningful < Math.ceil(previewMeaningful * 0.86);
}

function meaningfulLength(text: string): number {
  return [...text].filter((ch) => /[A-Za-z0-9_\u3400-\u9fff]/u.test(ch)).length;
}

function isLowInformation(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  const meaningful = meaningfulLength(trimmed);
  return meaningful === 0 || (meaningful === 1 && [...trimmed].length <= 2);
}

function isUnsupportedLanguage(text: string): boolean {
  if (!text.trim()) return false;
  const total = [...text].filter((ch) => /\p{Letter}/u.test(ch)).length;
  if (total === 0) return false;
  const unsupported = [...text].filter((ch) => /[\u3040-\u30ff\u31f0-\u31ff\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u.test(ch)).length;
  return unsupported >= 2 && unsupported / total > 0.25;
}
