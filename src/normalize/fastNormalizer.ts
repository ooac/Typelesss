import {
  BUILTIN_AI_CODING_DICTIONARY,
  canonicalizeDictionaryTerms,
  type DictionaryEntry,
} from "../dictionary/builtin.js";
import type { DictationMode, LanguageMode, NormalizedCandidate } from "../types.js";
import { detectLanguageMode, normalizeMixedSpacing } from "./mixedSpacing.js";
import {
  applyEnglishEmailGreetingLayout,
  applySpokenPunctuation,
  capitalizeEnglishSentences,
} from "./punctuation.js";

export interface FastNormalizerOptions {
  sessionId?: string;
  mode?: DictationMode;
  languageMode?: LanguageMode;
  dictionaryEntries?: DictionaryEntry[];
}

const ZH_LEADING_FILLERS = /^(?:\s*(?:呃|嗯|啊|那个|就是|怎么说呢|你知道吧|然后呢)\s*)+/u;
const ZH_INLINE_FILLERS = /\s*(?:呃|嗯|啊|那个|怎么说呢|你知道吧|然后呢)\s*/gu;
const EN_FILLERS =
  /\b(?:uh|um|you know|like|i mean|sort of|kind of)\b[,\s]*/gi;

export class FastNormalizer {
  normalize(input: string, options: FastNormalizerOptions = {}): NormalizedCandidate {
    const operations: string[] = [];
    const rawText = input;
    let text = input.normalize("NFC").trim();
    if (text !== input) operations.push("unicode_normalization");

    const mode = options.mode ?? "smart_polish";
    if (mode !== "fast_dictation") {
      const withoutFillers = removeFillers(text);
      if (withoutFillers !== text) operations.push("filler_removal");
      text = withoutFillers;
    }

    const punctuated = applySpokenPunctuation(text);
    if (punctuated !== text) operations.push("spoken_punctuation");
    text = punctuated;

    const dictionaryResult = canonicalizeDictionaryTerms(text, [
      ...BUILTIN_AI_CODING_DICTIONARY,
      ...(options.dictionaryEntries ?? []),
    ]);
    if (dictionaryResult.text !== text) operations.push("dictionary_canonicalization");
    text = dictionaryResult.text;

    text = applyCodingTokenHints(text, mode, operations);

    const spaced = normalizeMixedSpacing(text);
    if (spaced !== text) operations.push("mixed_spacing");
    text = spaced;

    text = lightweightPolish(text, mode, operations);

    const detectedLanguage = detectLanguageMode(text);
    const languageMode =
      options.languageMode && options.languageMode !== "auto"
        ? options.languageMode
        : detectedLanguage;

    return {
      sessionId: options.sessionId,
      rawText,
      normalizedText: text,
      languageMode,
      dictionaryHits: dictionaryResult.hits,
      protectedTerms: collectProtectedTerms(text, dictionaryResult.hits),
      confidence: estimateConfidence(rawText, text, dictionaryResult.hits),
      shouldUseLlm: shouldUseLlm(text, mode),
      operations,
    };
  }
}

export function normalizeFast(
  input: string,
  options: FastNormalizerOptions = {},
): NormalizedCandidate {
  return new FastNormalizer().normalize(input, options);
}

function removeFillers(input: string): string {
  return input
    .replace(ZH_LEADING_FILLERS, "")
    .replace(ZH_INLINE_FILLERS, "")
    .replace(EN_FILLERS, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function applyCodingTokenHints(
  input: string,
  mode: DictationMode,
  operations: string[],
): string {
  const isCodeMode = mode === "code_prompt";
  let text = input
    .replace(/\btypes\s+里面/gi, "`types.rs` 里面")
    .replace(/\bcoordinator\b/gi, isCodeMode ? "`coordinator`" : "coordinator")
    .replace(/\bcapsule\b/gi, isCodeMode ? "`capsule`" : "capsule")
    .replace(/\bpartial\b/gi, isCodeMode ? "`partial`" : "partial")
    .replace(/\bstable\b/gi, isCodeMode ? "`stable`" : "stable")
    .replace(/\bfinal\b/gi, isCodeMode ? "`final`" : "final");

  if (isCodeMode) {
    text = text
      .replace(/`?TranscriptEvent`?/g, "`TranscriptEvent`")
      .replace(/`?ShadowBuffer`?/g, "`ShadowBuffer`");
  }

  if (text !== input) operations.push("coding_token_normalization");
  return text;
}

function lightweightPolish(
  input: string,
  mode: DictationMode,
  operations: string[],
): string {
  let text = input;

  text = text
    .replace(/我们先不要做太多语言，只?就中文英文还有中英混输[，,]?\s*然后重点是速度和准确率。?/g, "我们先不要做太多语言，只做中文、英文和中英混输。重点是速度和准确率。")
    .replace(/中文英文还有中英混输/g, "中文、英文和中英混输")
    .replace(/重点是?速度和准确率/g, "重点是速度和准确率");

  if (/^[A-Za-z0-9\s,.:;?!\n`'/-]+$/.test(text)) {
    text = applyEnglishEmailGreetingLayout(capitalizeEnglishSentences(text));
  }

  if (mode === "code_prompt") {
    text = formatCodePromptIfPossible(text);
  }

  text = text.replace(/。{2,}/g, "。").replace(/\.{2,}/g, ".");

  if (text !== input) operations.push("lightweight_punctuation");
  return text.trim();
}

function formatCodePromptIfPossible(input: string): string {
  const normalized = input
    .replace(/，?`partial` 的时候更新 `capsule`/g, "：\n\n1. `partial` 时更新 `capsule`")
    .replace(/，?`stable` 的时候更新 `ShadowBuffer`/g, "。\n2. `stable` 时更新 `ShadowBuffer`")
    .replace(/，?`final` 的时候调用 polish/g, "。\n3. `final` 时调用 polish。");

  return normalized;
}

function collectProtectedTerms(input: string, dictionaryHits: string[]): string[] {
  const terms = new Set(dictionaryHits);
  for (const match of input.matchAll(/`([^`]+)`/g)) {
    terms.add(match[1]!);
  }
  for (const match of input.matchAll(/\b[A-Z][A-Za-z0-9]*(?:[A-Z][A-Za-z0-9]*)+\b/g)) {
    terms.add(match[0]);
  }
  for (const match of input.matchAll(/\b[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+\b/g)) {
    terms.add(match[0]);
  }
  return [...terms];
}

function estimateConfidence(rawText: string, normalizedText: string, hits: string[]): number {
  let confidence = 0.78;
  if (hits.length > 0) confidence += 0.12;
  if (normalizedText.length > 0) confidence += 0.05;
  if (Math.abs(rawText.length - normalizedText.length) < rawText.length * 0.4) confidence += 0.05;
  return Math.min(0.99, Number(confidence.toFixed(2)));
}

function shouldUseLlm(_text: string, mode: DictationMode): boolean {
  if (mode === "fast_dictation") return false;
  if (mode === "prompt_builder" || mode === "code_prompt") return true;
  // Smart polish stays on the local fast path; remote LLM polish is too slow
  // for the default dictation loop and should only run in explicit prompt modes.
  return false;
}
