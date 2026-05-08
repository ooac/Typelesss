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
