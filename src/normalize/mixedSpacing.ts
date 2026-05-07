const CJK = "\\u3400-\\u9fff";

export function normalizeMixedSpacing(input: string): string {
  return input
    .replace(new RegExp(`([${CJK}])([A-Za-z0-9_\`])`, "g"), "$1 $2")
    .replace(new RegExp(`([A-Za-z0-9_\`])([${CJK}])`, "g"), "$1 $2")
    .replace(/\s+([，。！？；：、,.!?;:])/g, "$1")
    .replace(/([（“([{])\s+/g, "$1")
    .replace(/\s+([）”)\]}])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function detectLanguageMode(input: string): "zh" | "en" | "mixed" {
  const cjkCount = [...input].filter((ch) => /[\u3400-\u9fff]/u.test(ch)).length;
  const asciiWordCount = input.match(/[A-Za-z][A-Za-z0-9_\-]*/g)?.length ?? 0;

  if (cjkCount > 0 && asciiWordCount > 0) {
    return "mixed";
  }

  if (cjkCount > 0) {
    return "zh";
  }

  return "en";
}
