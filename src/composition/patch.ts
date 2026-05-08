export type CompositionPatchKind = "preview" | "stable" | "final" | "rollback";

export interface CompositionPatch {
  revision: number;
  kind: CompositionPatchKind;
  start: number;
  end: number;
  replacement: string;
}

export function createTextPatch(
  previous: string,
  next: string,
  revision: number,
  kind: CompositionPatchKind,
): CompositionPatch {
  let prefix = 0;
  const maxPrefix = Math.min(previous.length, next.length);
  while (prefix < maxPrefix && previous[prefix] === next[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  return {
    revision,
    kind,
    start: prefix,
    end: previous.length - suffix,
    replacement: next.slice(prefix, next.length - suffix),
  };
}

export function applyTextPatch(previous: string, patch: CompositionPatch): string {
  return previous.slice(0, patch.start) + patch.replacement + previous.slice(patch.end);
}
