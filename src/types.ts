export type LanguageMode = "auto" | "zh" | "en" | "mixed";

export type DictationMode =
  | "fast_dictation"
  | "smart_polish"
  | "prompt_builder"
  | "code_prompt";

export type TranscriptEventKind = "partial" | "stable" | "final" | "error";

export interface TranscriptEvent {
  sessionId: string;
  kind: TranscriptEventKind;
  text: string;
  range?: [number, number];
  confidence?: number;
  language?: LanguageMode;
  providerId: string;
  timestampMs: number;
  recoverable?: boolean;
  errorMessage?: string;
}

export interface NormalizedCandidate {
  sessionId?: string;
  rawText: string;
  normalizedText: string;
  languageMode: LanguageMode;
  dictionaryHits: string[];
  protectedTerms: string[];
  confidence: number;
  shouldUseLlm: boolean;
  operations: string[];
}

export interface StabilizedOutput {
  stableText: string;
  previewText: string;
  revision: number;
  final: boolean;
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
  fallbackText?: string;
}
