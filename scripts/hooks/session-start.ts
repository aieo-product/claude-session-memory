/**
 * claude-session-memory - SessionStart Hook
 *
 * 1. DB にセッション作成
 * 2. 過去コンテキストを XML で stdout 注入
 *
 * Timeout: 5s
 * stdin: { session_id, cwd }
 */
import { getDb, closeDb } from "../db";
import { getProjectName, getGitBranch } from "../lib/config";
import { buildFullContext } from "../lib/memory-injector";

async function main() {
  let input: { session_id?: string; cwd?: string } = {};

  try {
    const stdin = await Bun.stdin.text();
    if (stdin.trim()) {
      input = JSON.parse(stdin);
    }
  } catch {
    // No stdin or invalid JSON — use env vars
  }

  const sessionId =
    input.session_id || process.env.CLAUDE_SESSION_ID || "unknown";
  const cwd =
    input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const projectName = getProjectName(cwd);
  const gitBranch = getGitBranch(cwd);

  try {
    const db = getDb();

    // Create session record
    db.run(
      `INSERT OR IGNORE INTO sessions (id, project, project_name, git_branch, start_time)
       VALUES (?, ?, ?, ?, ?)`,
      [sessionId, cwd, projectName, gitBranch, new Date().toISOString()]
    );

    // Build and output context injection
    const xml = buildFullContext(db, sessionId, cwd);
    if (xml) {
      process.stdout.write(xml);
    }

    closeDb();
  } catch (err) {
    // Hook must not block Claude Code — fail silently
    process.stderr.write(
      `[session-memory:session-start] Error: ${err}\n`
    );
  }
}

main();
