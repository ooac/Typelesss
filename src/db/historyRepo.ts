import Database from "@tauri-apps/plugin-sql";

const DB_URL = "sqlite:typelesss-history.db";

let dbPromise: Promise<Database> | null = null;

function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load(DB_URL);
  }
  return dbPromise;
}

export interface DictationSession {
  id: string;
  startedAt: number;
  durationMs: number;
  rawText: string;
  normalizedText: string;
  finalText: string;
  outputMode: string;
  asrProvider: string;
  polishProvider: string;
  targetApp: string;
}

export interface CorrectionPair {
  id: string;
  sessionId: string;
  beforeText: string;
  afterText: string;
  source: string;
  createdAt: number;
}

export interface PersonalTerm {
  id: string;
  canonical: string;
  aliases: string[];
  category: string;
  source: string;
  weight: number;
  usageCount: number;
  lastSeenAt: number;
}

export interface AsrTelemetryInput {
  sessionId: string;
  providerId: string;
  targetApp?: string;
  hotkeyDownAt?: number | null;
  firstAudioSentAt?: number | null;
  firstPartialAt?: number | null;
  stableInsertAt?: number | null;
  finalReceivedAt?: number | null;
  insertDoneAt?: number | null;
  error?: string;
}

interface SessionRow {
  id: string;
  started_at: number;
  duration_ms: number;
  raw_text: string;
  normalized_text: string;
  final_text: string;
  output_mode: string;
  asr_provider: string;
  polish_provider: string;
  target_app: string;
}

interface PersonalTermRow {
  id: string;
  canonical: string;
  aliases_json: string;
  category: string;
  source: string;
  weight: number;
  usage_count: number;
  last_seen_at: number;
}

function rowToSession(row: SessionRow): DictationSession {
  return {
    id: row.id,
    startedAt: row.started_at,
    durationMs: row.duration_ms,
    rawText: row.raw_text,
    normalizedText: row.normalized_text,
    finalText: row.final_text,
    outputMode: row.output_mode,
    asrProvider: row.asr_provider,
    polishProvider: row.polish_provider,
    targetApp: row.target_app,
  };
}

function generateId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function generatePrefixedId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function insertSession(
  partial: Omit<DictationSession, "id"> & { id?: string },
  correction?: { beforeText: string; afterText: string; source?: string },
): Promise<DictationSession> {
  const db = await getDb();
  const id = partial.id ?? generateId();
  await db.execute(
    `INSERT INTO dictation_sessions
       (id, started_at, duration_ms, raw_text, normalized_text, final_text,
        output_mode, asr_provider, polish_provider, target_app)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      partial.startedAt,
      partial.durationMs,
      partial.rawText,
      partial.normalizedText,
      partial.finalText,
      partial.outputMode,
      partial.asrProvider,
      partial.polishProvider,
      partial.targetApp,
    ],
  );

  if (correction && correction.beforeText !== correction.afterText) {
    const pairId = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    await db.execute(
      `INSERT INTO correction_pairs
         (id, session_id, before_text, after_text, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        pairId,
        id,
        correction.beforeText,
        correction.afterText,
        correction.source ?? "auto",
        Date.now(),
      ],
    );
  }

  return { ...partial, id };
}

export async function recordAsrTelemetry(input: AsrTelemetryInput): Promise<void> {
  const db = await getDb();
  const asrLatencyMs =
    input.firstPartialAt && input.firstAudioSentAt
      ? input.firstPartialAt - input.firstAudioSentAt
      : null;
  const finalLatencyMs =
    input.finalReceivedAt && input.hotkeyDownAt
      ? input.finalReceivedAt - input.hotkeyDownAt
      : null;
  const insertLatencyMs =
    input.insertDoneAt && input.finalReceivedAt
      ? input.insertDoneAt - input.finalReceivedAt
      : null;
  await db.execute(
    `INSERT INTO asr_telemetry
       (id, session_id, provider_id, target_app, hotkey_down_at, first_audio_sent_at,
        first_partial_at, stable_insert_at, final_received_at, insert_done_at,
        asr_latency_ms, final_latency_ms, insert_latency_ms, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      generatePrefixedId("t"),
      input.sessionId,
      input.providerId,
      input.targetApp ?? "",
      input.hotkeyDownAt ?? null,
      input.firstAudioSentAt ?? null,
      input.firstPartialAt ?? null,
      input.stableInsertAt ?? null,
      input.finalReceivedAt ?? null,
      input.insertDoneAt ?? null,
      asrLatencyMs,
      finalLatencyMs,
      insertLatencyMs,
      input.error ?? "",
      Date.now(),
    ],
  );
}

export async function listPersonalTerms(limit = 80): Promise<PersonalTerm[]> {
  const db = await getDb();
  const rows = await db.select<PersonalTermRow[]>(
    `SELECT * FROM personal_terms
     ORDER BY weight DESC, usage_count DESC, last_seen_at DESC
     LIMIT ?`,
    [limit],
  );
  return rows.map((row) => ({
    id: row.id,
    canonical: row.canonical,
    aliases: safeParseStringArray(row.aliases_json),
    category: row.category,
    source: row.source,
    weight: row.weight,
    usageCount: row.usage_count,
    lastSeenAt: row.last_seen_at,
  }));
}

export async function learnPersonalTermsFromText(text: string, source = "session"): Promise<void> {
  const terms = extractPersonalTermCandidates(text);
  if (terms.length === 0) return;
  const db = await getDb();
  const now = Date.now();
  for (const term of terms) {
    await db.execute(
      `INSERT INTO personal_terms
         (id, canonical, aliases_json, category, source, weight, usage_count, created_at, last_seen_at)
       VALUES (?, ?, '[]', 'personal', ?, 1, 1, ?, ?)
       ON CONFLICT(canonical) DO UPDATE SET
         usage_count = usage_count + 1,
         weight = MIN(weight + 0.25, 10),
         last_seen_at = excluded.last_seen_at`,
      [generatePrefixedId("p"), term, source, now, now],
    );
  }
}

export async function listRecentSessions(limit = 200): Promise<DictationSession[]> {
  const db = await getDb();
  const rows = await db.select<SessionRow[]>(
    `SELECT * FROM dictation_sessions ORDER BY started_at DESC LIMIT ?`,
    [limit],
  );
  return rows.map(rowToSession);
}

export async function searchSessions(query: string, limit = 200): Promise<DictationSession[]> {
  const db = await getDb();
  const trimmed = query.trim();
  if (!trimmed) return listRecentSessions(limit);
  const like = `%${trimmed.replace(/[%_]/g, (m) => `\\${m}`)}%`;
  const rows = await db.select<SessionRow[]>(
    `SELECT * FROM dictation_sessions
     WHERE final_text LIKE ? ESCAPE '\\'
        OR raw_text LIKE ? ESCAPE '\\'
        OR normalized_text LIKE ? ESCAPE '\\'
     ORDER BY started_at DESC
     LIMIT ?`,
    [like, like, like, limit],
  );
  return rows.map(rowToSession);
}

export async function deleteSession(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM dictation_sessions WHERE id = ?`, [id]);
  await db.execute(`DELETE FROM correction_pairs WHERE session_id = ?`, [id]);
}

export async function clearAllSessions(): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM correction_pairs`);
  await db.execute(`DELETE FROM dictation_sessions`);
}

function safeParseStringArray(input: string): string[] {
  try {
    const value = JSON.parse(input);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function extractPersonalTermCandidates(text: string): string[] {
  const terms = new Set<string>();
  for (const match of text.matchAll(/`([^`]{2,48})`/g)) {
    terms.add(match[1]!.trim());
  }
  for (const match of text.matchAll(/\b[A-Z][A-Za-z0-9]*(?:[A-Z][A-Za-z0-9]*)+\b/g)) {
    terms.add(match[0]);
  }
  for (const match of text.matchAll(/\b[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+\b/g)) {
    terms.add(match[0]);
  }
  for (const match of text.matchAll(/\b(?:Claude Code|OpenAI Codex|Tauri|src-tauri|TranscriptEvent|ShadowBuffer|WebSocket|TypeScript|Rust|React|Vite)\b/g)) {
    terms.add(match[0]);
  }
  return [...terms].filter((term) => term.length >= 2 && term.length <= 64);
}
