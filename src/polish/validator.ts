import { collectDictionaryTerms } from "../dictionary/builtin.js";
import type { ValidationResult } from "../types.js";

const ASSISTANT_PREAMBLE = /^(以下是|当然|好的|可以|Here is|Sure|Certainly)\b[:：，,\s]*/i;

export function validatePolishOutput(input: string, output: string): ValidationResult {
  const trimmed = output.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty_output", fallbackText: input };
  }

  if (ASSISTANT_PREAMBLE.test(trimmed)) {
    return {
      ok: false,
      reason: "assistant_preamble",
      fallbackText: stripPreamble(trimmed),
    };
  }

  if (looksLikeAnswerInsteadOfRewrite(input, trimmed)) {
    return { ok: false, reason: "answered_instead_of_rewrite", fallbackText: input };
  }

  const lost = lostCriticalTerms(input, trimmed);
  if (lost.length > 0) {
    return {
      ok: false,
      reason: `critical_terms_lost:${lost.join(",")}`,
      fallbackText: input,
    };
  }

  return { ok: true };
}

export function stripPreamble(output: string): string {
  return output.replace(ASSISTANT_PREAMBLE, "").trim();
}

export function looksLikeAnswerInsteadOfRewrite(input: string, output: string): boolean {
  const userAskedQuestion = /[？?]\s*$/.test(input.trim());
  if (!userAskedQuestion) return false;

  return /(?:以下|包括|可以从|主要有|建议|步骤|原因|because|you can|should)/i.test(output);
}

export function lostCriticalTerms(input: string, output: string): string[] {
  const terms = extractCriticalTerms(input);
  const outputLower = output.toLowerCase();
  return terms.filter((term) => !outputLower.includes(term.toLowerCase()));
}

export function extractCriticalTerms(input: string): string[] {
  const terms = new Set<string>(collectDictionaryTerms(input));

  for (const match of input.matchAll(/`([^`]+)`/g)) terms.add(match[1]!);
  for (const match of input.matchAll(/\b[A-Z][A-Za-z0-9]*(?:[A-Z][A-Za-z0-9]*)+\b/g)) {
    terms.add(match[0]);
  }
  for (const match of input.matchAll(/\b[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+\b/g)) {
    terms.add(match[0]);
  }
  for (const match of input.matchAll(/\b[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)+\b/g)) {
    terms.add(match[0]);
  }

  return [...terms];
}
