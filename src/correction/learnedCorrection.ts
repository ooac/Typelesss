export interface LearnedCorrection {
  beforeText: string;
  afterText: string;
}

export function inferSelectedTextCorrection(
  insertedText: string,
  selectedText: string,
): LearnedCorrection | null {
  const selected = selectedText.trim();
  if (!selected) return null;
  return findBestTokenCorrection(insertedText, selected);
}

export function inferReadbackCorrection(
  insertedText: string,
  readbackText: string,
): LearnedCorrection | null {
  const before = insertedText.trim();
  const after = readbackText.trim();
  if (!isUsefulCorrectionPair(before, after)) return null;

  const tokenCorrection = findBestTokenCorrection(before, after);
  if (tokenCorrection) return tokenCorrection;

  return areTextsCloselyRelated(before, after) ? { beforeText: before, afterText: after } : null;
}

export function isSafeLearnedCorrection(beforeText: string, afterText: string): boolean {
  return isUsefulCorrectionPair(beforeText.trim(), afterText.trim())
    && areTextsCloselyRelated(beforeText, afterText);
}

function findBestTokenCorrection(beforeText: string, afterText: string): LearnedCorrection | null {
  const beforeCandidates = buildCorrectionCandidates(beforeText);
  const afterCandidates = buildCorrectionCandidates(afterText);
  let best: { before: string; after: string; distance: number; maxLen: number } | null = null;

  for (const before of beforeCandidates) {
    for (const after of afterCandidates) {
      if (!isUsefulCorrectionPair(before, after)) continue;
      if (!areTextsCloselyRelated(before, after)) continue;
      const distance = levenshtein(compactForCompare(before), compactForCompare(after));
      const maxLen = Math.max([...compactForCompare(before)].length, [...compactForCompare(after)].length, 1);
      if (
        !best ||
        distance < best.distance ||
        (distance === best.distance && maxLen < best.maxLen)
      ) {
        best = { before, after, distance, maxLen };
      }
    }
  }

  return best ? { beforeText: best.before, afterText: best.after } : null;
}

function buildCorrectionCandidates(text: string): string[] {
  const tokens = text.match(/[A-Za-z0-9_.-]+|[\u3400-\u9fff]+/gu) ?? [];
  const candidates = new Set<string>();
  for (let start = 0; start < tokens.length; start += 1) {
    for (let size = 1; size <= 3 && start + size <= tokens.length; size += 1) {
      const candidate = tokens.slice(start, start + size).join(" ").trim();
      if (candidate.length >= 2 && candidate.length <= 48) {
        candidates.add(candidate);
      }
    }
  }
  return [...candidates];
}

function isUsefulCorrectionPair(before: string, after: string): boolean {
  if (!before || !after || before === after) return false;
  if (before.length > 120 || after.length > 120) return false;
  if (/^[\s\p{P}\p{S}]+$/u.test(before) || /^[\s\p{P}\p{S}]+$/u.test(after)) return false;
  const maxLen = Math.max([...before].length, [...after].length, 1);
  const minLen = Math.min([...before].length, [...after].length);
  if (minLen < 2) return false;
  return maxLen <= minLen * 2 + 8;
}

function areTextsCloselyRelated(left: string, right: string): boolean {
  const a = compactForCompare(left);
  const b = compactForCompare(right);
  if (a.length < 2 || b.length < 2) return false;
  const maxLen = Math.max([...a].length, [...b].length, 1);
  const minLen = Math.min([...a].length, [...b].length);
  if (maxLen > minLen * 2 + 8) return false;
  const distance = levenshtein(a, b);
  return distance <= Math.max(1, Math.floor(maxLen * 0.42));
}

function compactForCompare(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function levenshtein(left: string, right: string): number {
  const a = [...left];
  const b = [...right];
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i]![0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }
  return dp[a.length]![b.length]!;
}
