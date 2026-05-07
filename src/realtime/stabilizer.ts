import type { StabilizedOutput } from "../types.js";

export interface TranscriptStabilizerOptions {
  minStableChars?: number;
  dictionaryTerms?: string[];
}

export class TranscriptStabilizer {
  private lastPartial = "";
  private stablePrefix = "";
  private revision = 0;
  private readonly minStableChars: number;
  private readonly dictionaryTerms: string[];

  constructor(options: TranscriptStabilizerOptions = {}) {
    this.minStableChars = options.minStableChars ?? 3;
    this.dictionaryTerms = options.dictionaryTerms ?? [];
  }

  onPartial(text: string): StabilizedOutput {
    const normalized = normalizeWhitespace(text);
    const lcp = longestCommonPrefix(this.lastPartial, normalized);
    const candidate = extendToSafeBoundary(lcp, {
      minStableChars: this.minStableChars,
      dictionaryTerms: this.dictionaryTerms,
    });

    if (candidate.length > this.stablePrefix.length) {
      this.stablePrefix = candidate;
      this.revision += 1;
    }

    this.lastPartial = normalized;
    return this.output(normalized, false);
  }

  onFinal(text: string): StabilizedOutput {
    const normalized = normalizeWhitespace(text);
    this.stablePrefix = normalized;
    this.lastPartial = normalized;
    this.revision += 1;
    return this.output(normalized, true);
  }

  reset(): void {
    this.lastPartial = "";
    this.stablePrefix = "";
    this.revision = 0;
  }

  private output(previewText: string, final: boolean): StabilizedOutput {
    return {
      stableText: this.stablePrefix,
      previewText,
      revision: this.revision,
      final,
    };
  }
}

export function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function longestCommonPrefix(a: string, b: string): string {
  const max = Math.min(a.length, b.length);
  let index = 0;
  while (index < max && a[index] === b[index]) index += 1;
  return a.slice(0, index);
}

export function extendToSafeBoundary(
  input: string,
  options: { minStableChars: number; dictionaryTerms: string[] },
): string {
  if (input.length < options.minStableChars) return "";
  if (endsInsideProtectedTerm(input, options.dictionaryTerms)) return "";

  const punctuationIndex = input.search(/[，。！？；：,.!?;:]\s*$/u);
  if (punctuationIndex >= 0) return input.trim();

  const lastSpace = input.lastIndexOf(" ");
  if (lastSpace >= options.minStableChars) {
    return input.slice(0, lastSpace + 1).trimEnd();
  }

  if (/[\u3400-\u9fff]$/u.test(input) && input.length >= options.minStableChars) {
    return input;
  }

  return "";
}

function endsInsideProtectedTerm(input: string, terms: string[]): boolean {
  const lower = input.toLowerCase();
  return terms.some((term) => {
    const normalized = term.toLowerCase();
    return normalized.startsWith(lower.slice(-normalized.length)) && lower.endsWith(normalized.slice(0, lower.length));
  });
}
