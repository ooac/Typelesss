export interface DictionaryEntry {
  canonical: string;
  aliases: string[];
  category: "product" | "model" | "framework" | "coding" | "company";
  language: "en" | "zh" | "mixed";
}

export const BUILTIN_AI_CODING_DICTIONARY: DictionaryEntry[] = [
  {
    canonical: "Claude Code",
    aliases: [
      "Claude.Claude Code",
      "Claude. Claude Code",
      "Claude Claude Code",
      "cloud code",
      "clawed code",
      "Claude code",
    ],
    category: "product",
    language: "en",
  },
  {
    canonical: "OpenAI Codex",
    aliases: [
      "Open AI Codex",
      "open ai codex",
      "OpenAI code X",
      "open ai code X",
      "code X",
      "code ex",
      "codex",
      "codecks",
    ],
    category: "product",
    language: "en",
  },
  {
    canonical: "OpenLess",
    aliases: ["open less", "Open Less"],
    category: "product",
    language: "en",
  },
  {
    canonical: "Typeless",
    aliases: ["tie plus", "type less", "type list"],
    category: "product",
    language: "en",
  },
  {
    canonical: "Wispr Flow",
    aliases: ["whisper flow", "wisper flow"],
    category: "product",
    language: "en",
  },
  {
    canonical: "Superwhisper",
    aliases: ["super whisper", "superwhisper"],
    category: "product",
    language: "en",
  },
  {
    canonical: "Aqua Voice",
    aliases: ["aqua voice"],
    category: "product",
    language: "en",
  },
  {
    canonical: "Tauri",
    aliases: ["torri", "towery", "tauri"],
    category: "framework",
    language: "en",
  },
  {
    canonical: "src-tauri",
    aliases: [
      "src-Tauri",
      "SRC-Tauri",
      "src tauri",
      "SRC tauri",
      "source tauri",
      "source-Tauri",
    ],
    category: "coding",
    language: "en",
  },
  {
    canonical: "WebSocket",
    aliases: ["web socket", "websocket"],
    category: "coding",
    language: "en",
  },
  {
    canonical: "TypeScript",
    aliases: ["typescript", "type script", "type scripts"],
    category: "coding",
    language: "en",
  },
  {
    canonical: "Rust",
    aliases: ["rust"],
    category: "coding",
    language: "en",
  },
  {
    canonical: "React",
    aliases: ["react"],
    category: "framework",
    language: "en",
  },
  {
    canonical: "Vite",
    aliases: ["vite", "veet"],
    category: "framework",
    language: "en",
  },
  {
    canonical: "GPT",
    aliases: ["gpt", "G P T", "G.P.T.", "G P D", "GPT"],
    category: "model",
    language: "en",
  },
  {
    canonical: "ShadowBuffer",
    aliases: ["shadow buffer", "shadowbuffer"],
    category: "coding",
    language: "en",
  },
  {
    canonical: "TranscriptEvent",
    aliases: ["transcript event", "transcript events"],
    category: "coding",
    language: "en",
  },
  {
    canonical: "realtime ASR",
    aliases: ["real time ASR", "realtime asr", "real time asr"],
    category: "coding",
    language: "mixed",
  },
];

export interface CanonicalizationResult {
  text: string;
  hits: string[];
}

export function canonicalizeDictionaryTerms(
  input: string,
  entries: DictionaryEntry[] = BUILTIN_AI_CODING_DICTIONARY,
): CanonicalizationResult {
  let text = input;
  const hits = new Set<string>();
  for (const entry of entries) {
    if (buildAliasPattern(entry.canonical).test(input)) {
      hits.add(entry.canonical);
    }
  }

  const replacements = entries.flatMap((entry) =>
    entry.aliases.map((alias) => ({ alias, entry })),
  );
  const canonicalTerms = entries.map((entry) => entry.canonical);

  replacements.sort((a, b) => b.alias.length - a.alias.length);

  for (const { alias, entry } of replacements) {
    const pattern = buildAliasPattern(alias);
    text = text.replace(pattern, (match, ...args: unknown[]) => {
      const offset = args.at(-2) as number;
      const fullText = args.at(-1) as string;
      if (isWithinAnyCanonicalTerm(fullText, offset, match.length, canonicalTerms)) {
        return match;
      }
      hits.add(entry.canonical);
      return entry.canonical;
    });
  }

  return { text, hits: [...hits] };
}

export function collectDictionaryTerms(
  input: string,
  entries: DictionaryEntry[] = BUILTIN_AI_CODING_DICTIONARY,
): string[] {
  return canonicalizeDictionaryTerms(input, entries).hits;
}

function buildAliasPattern(alias: string): RegExp {
  const escaped = escapeRegExp(alias).replace(/\s+/g, "\\s+");
  if (/^[A-Za-z0-9_\-\s]+$/.test(alias)) {
    return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, "gi");
  }

  return new RegExp(escaped, "g");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isWithinAnyCanonicalTerm(
  text: string,
  offset: number,
  matchLength: number,
  canonicalTerms: string[],
): boolean {
  return canonicalTerms.some((canonical) => {
    const startMin = Math.max(0, offset - canonical.length + matchLength);
    const startMax = Math.min(offset, text.length - canonical.length);

    for (let start = startMin; start <= startMax; start++) {
      if (text.slice(start, start + canonical.length) === canonical) {
        return true;
      }
    }

    return false;
  });
}
