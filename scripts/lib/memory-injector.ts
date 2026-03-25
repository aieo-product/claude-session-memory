/**
 * claude-session-memory - Memory Injector
 *
 * DB からコンテキストを取得し、XML 形式で出力する。
 * SessionStart: フル注入 / UserPromptSubmit: 差分注入
 */
import type { Database } from "bun:sqlite";
import { getConfig } from "./config";

interface SessionRow {
  id: string;
  project: string;
  project_name: string | null;
  end_time: string | null;
  summary: string | null;
}

interface DecisionRow {
  id: number;
  decision: string;
  category: string;
  timestamp: string;
  session_id: string;
  resolved: number;
}

interface MemoryBlockRow {
  key: string;
  value: string;
  category: string;
  updated_at: string;
}

/**
 * SessionStart 用: フルコンテキスト注入 XML を生成
 */
export function buildFullContext(
  db: Database,
  sessionId: string,
  project: string
): string {
  const config = getConfig();
  const parts: string[] = [];

  parts.push(
    `<session-memory source="session-memory" session="${sessionId}" injected_at="${new Date().toISOString()}">`
  );

  // 1. Previous session summary
  if (config.session_start.include_last_summary) {
    const prev = db
      .query(
        `SELECT id, project, project_name, end_time, summary
         FROM sessions
         WHERE project = ? AND id != ? AND summary IS NOT NULL
         ORDER BY start_time DESC LIMIT 1`
      )
      .get(project, sessionId) as SessionRow | null;

    if (prev?.summary) {
      parts.push(
        `  <previous-session project="${prev.project_name || prev.project}" ended="${prev.end_time || "unknown"}">`,
        `    <summary>${escapeXml(prev.summary)}</summary>`,
        "  </previous-session>"
      );
    }
  }

  // 2. Recent decisions
  const recentDecisions = db
    .query(
      `SELECT d.id, d.decision, d.category, d.timestamp, d.session_id, d.resolved
       FROM decisions d
       JOIN sessions s ON d.session_id = s.id
       WHERE s.project = ? AND d.resolved = 0
       ORDER BY d.timestamp DESC
       LIMIT ?`
    )
    .all(project, config.session_start.max_decisions) as DecisionRow[];

  if (recentDecisions.length > 0) {
    parts.push(`  <recent-decisions count="${recentDecisions.length}">`);
    for (const d of recentDecisions) {
      parts.push(
        `    <decision id="${d.id}" category="${d.category}" timestamp="${d.timestamp}">${escapeXml(d.decision)}</decision>`
      );
    }
    parts.push("  </recent-decisions>");
  }

  // 3. Memory blocks (project-scoped + global)
  const blocks = db
    .query(
      `SELECT key, value, category, updated_at
       FROM memory_blocks
       WHERE project = ? OR project IS NULL
       ORDER BY updated_at DESC
       LIMIT ?`
    )
    .all(project, config.session_start.max_memory_blocks) as MemoryBlockRow[];

  if (blocks.length > 0) {
    parts.push(`  <memory-blocks count="${blocks.length}">`);
    for (const b of blocks) {
      parts.push(
        `    <block key="${escapeXml(b.key)}" category="${b.category}" updated="${b.updated_at}">${escapeXml(b.value)}</block>`
      );
    }
    parts.push("  </memory-blocks>");
  }

  parts.push("</session-memory>");

  return parts.join("\n");
}

/**
 * UserPromptSubmit 用: 差分注入 XML を生成
 * セッション開始時刻以降に更新された memory_blocks のみ
 */
export function buildDiffContext(
  db: Database,
  sessionId: string,
  project: string
): string | null {
  // Get session start time
  const session = db
    .query("SELECT start_time FROM sessions WHERE id = ?")
    .get(sessionId) as { start_time: string } | null;

  if (!session) return null;

  const newBlocks = db
    .query(
      `SELECT key, value, category, updated_at
       FROM memory_blocks
       WHERE (project = ? OR project IS NULL)
         AND updated_at > ?
         AND source_session_id != ?
       ORDER BY updated_at DESC
       LIMIT 5`
    )
    .all(project, session.start_time, sessionId) as MemoryBlockRow[];

  if (newBlocks.length === 0) return null;

  const parts: string[] = [];
  parts.push(
    `<session-memory-update since="${session.start_time}">`
  );
  for (const b of newBlocks) {
    parts.push(
      `  <new-memory key="${escapeXml(b.key)}" category="${b.category}">${escapeXml(b.value)}</new-memory>`
    );
  }
  parts.push("</session-memory-update>");

  return parts.join("\n");
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
