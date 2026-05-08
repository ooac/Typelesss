import { Clipboard, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  deleteSession,
  listRecentSessions,
  searchSessions,
  type DictationSession,
} from "../db/historyRepo.js";
import { useApp } from "../state/AppContext.js";

interface DateGroup {
  label: string;
  items: DictationSession[];
}

export function HistoryPage() {
  const { historyRevision, isTauriRuntime } = useApp();
  const [sessions, setSessions] = useState<DictationSession[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isTauriRuntime) {
      setSessions([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = query.trim()
        ? await searchSessions(query.trim())
        : await listRecentSessions();
      setSessions(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [isTauriRuntime, query]);

  useEffect(() => {
    void refresh();
  }, [refresh, historyRevision]);

  const groups = useMemo(() => groupByDate(sessions), [sessions]);

  const onCopy = async (session: DictationSession) => {
    await navigator.clipboard.writeText(session.finalText);
    setCopied(session.id);
    window.setTimeout(() => setCopied(null), 1500);
  };

  const onDelete = async (id: string) => {
    if (!isTauriRuntime) return;
    try {
      await deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <section className="page page-history">
      <header className="page-header">
        <span className="section-kicker">历史</span>
        <h1>最近结果</h1>
        <p className="page-description">
          所有完成的录音都会自动保存到本地 SQLite。最近 200 条可搜索，按日期分组。
        </p>
      </header>

      <div className="history-toolbar">
        <div className="history-search">
          <Search size={14} />
          <input
            type="search"
            placeholder="搜索 ASR 原文 / 规范化 / 最终文本…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            spellCheck={false}
          />
        </div>
      </div>

      {error ? (
        <div className="error-panel" role="alert">
          <span>{error}</span>
        </div>
      ) : null}

      <div className="history-list">
        {loading && sessions.length === 0 ? (
          <p className="empty">加载中…</p>
        ) : sessions.length === 0 ? (
          <p className="empty">{query.trim() ? "没有匹配的结果。" : "暂无历史。"}</p>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="history-group">
              <h3 className="date-divider">{group.label}</h3>
              {group.items.map((session) => (
                <article key={session.id} className="history-row">
                  <div className="history-row__main">
                    <p className="history-row__text">{session.finalText || "（空）"}</p>
                    <div className="history-row__meta">
                      <span>{formatTime(session.startedAt)}</span>
                      <span>·</span>
                      <span>{formatDuration(session.durationMs)}</span>
                      <span>·</span>
                      <span>{session.outputMode}</span>
                      {session.asrProvider ? (
                        <>
                          <span>·</span>
                          <span>{session.asrProvider}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="history-row__actions">
                    <button
                      type="button"
                      className="ghost compact"
                      onClick={() => void onCopy(session)}
                    >
                      <Clipboard size={14} />
                      {copied === session.id ? "已复制" : "复制"}
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="删除"
                      onClick={() => void onDelete(session.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function groupByDate(items: DictationSession[]): DateGroup[] {
  const today = startOfDay(new Date());
  const yesterday = today - 24 * 3600 * 1000;
  const sevenDaysAgo = today - 7 * 24 * 3600 * 1000;
  const groups = new Map<string, DictationSession[]>();
  const order: string[] = [];

  const push = (label: string, item: DictationSession) => {
    if (!groups.has(label)) {
      groups.set(label, []);
      order.push(label);
    }
    groups.get(label)!.push(item);
  };

  items.forEach((item) => {
    const start = item.startedAt;
    if (start >= today) push("今天", item);
    else if (start >= yesterday) push("昨天", item);
    else if (start >= sevenDaysAgo) push("最近 7 天", item);
    else push(formatMonth(start), item);
  });

  return order.map((label) => ({ label, items: groups.get(label) ?? [] }));
}

function startOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
}

function formatDuration(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec} 秒`;
  return `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, "0")}`;
}

function formatMonth(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
}
