/**
 * claude-session-memory — SQLite Database Layer
 *
 * bun:sqlite WAL mode for concurrent access across sessions.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getConfig } from "./lib/config";

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  project_name TEXT,
  git_branch TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT,
  summary TEXT,
  message_count INTEGER DEFAULT 0,
  tool_use_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON sessions(start_time);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL,
  content TEXT,
  tool_name TEXT,
  tool_input TEXT,
  tool_result TEXT,
  timestamp TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);
CREATE INDEX IF NOT EXISTS idx_messages_tool ON messages(tool_name);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);

CREATE TABLE IF NOT EXISTS memory_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  project TEXT,
  category TEXT DEFAULT 'general',
  source_session_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(key, project)
);
CREATE INDEX IF NOT EXISTS idx_memory_project ON memory_blocks(project);
CREATE INDEX IF NOT EXISTS idx_memory_category ON memory_blocks(category);

CREATE TABLE IF NOT EXISTS decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  decision TEXT NOT NULL,
  context TEXT,
  rationale TEXT,
  category TEXT DEFAULT 'general',
  resolved INTEGER DEFAULT 0,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_decisions_session ON decisions(session_id);
CREATE INDEX IF NOT EXISTS idx_decisions_category ON decisions(category);
CREATE INDEX IF NOT EXISTS idx_decisions_resolved ON decisions(resolved);
`;

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;

  const config = getConfig();
  const dbPath = config.db_path.replace("~", process.env.HOME || "");

  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  _db = new Database(dbPath);
  _db.run("PRAGMA journal_mode = WAL");
  _db.run("PRAGMA busy_timeout = 5000");

  initSchema(_db);
  return _db;
}

function initSchema(db: Database): void {
  const row = db
    .query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
    )
    .get() as { name: string } | null;

  if (!row) {
    db.exec(SCHEMA_SQL);
    db.run("INSERT OR IGNORE INTO schema_version (version) VALUES (?)", [
      SCHEMA_VERSION,
    ]);
  }
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

if (import.meta.main) {
  const db = getDb();
  const tables = db
    .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[];
  console.log("Session Memory DB initialized:");
  console.log(
    `  Path: ${getConfig().db_path.replace("~", process.env.HOME || "")}`
  );
  console.log(`  Tables: ${tables.map((t) => t.name).join(", ")}`);
  closeDb();
}
