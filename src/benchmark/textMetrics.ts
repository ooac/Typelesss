export function characterErrorRate(reference: string, hypothesis: string): number {
  const ref = [...reference];
  if (ref.length === 0) return hypothesis.length === 0 ? 0 : 1;
  return levenshtein(ref, [...hypothesis]) / ref.length;
}

export function wordErrorRate(reference: string, hypothesis: string): number {
  const ref = tokenizeWords(reference);
  if (ref.length === 0) return tokenizeWords(hypothesis).length === 0 ? 0 : 1;
  return levenshtein(ref, tokenizeWords(hypothesis)) / ref.length;
}

export function termRecall(expectedTerms: string[], output: string): number {
  if (expectedTerms.length === 0) return 1;
  const lower = output.toLowerCase();
  const hits = expectedTerms.filter((term) => lower.includes(term.toLowerCase())).length;
  return hits / expectedTerms.length;
}

function tokenizeWords(input: string): string[] {
  return input.toLowerCase().match(/[a-z0-9_'-]+|[\u3400-\u9fff]/gu) ?? [];
}

function levenshtein<T>(a: T[], b: T[]): number {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i]![0] = i;
  for (let j = 0; j <= b.length; j++) dp[0]![j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = Object.is(a[i - 1], b[j - 1]) ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }

  return dp[a.length]![b.length]!;
}
