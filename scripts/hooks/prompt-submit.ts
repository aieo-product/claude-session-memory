/**
 * claude-session-memory - UserPromptSubmit Hook
 *
 * セッション開始以降に更新された memory_blocks があれば差分注入する。
 * 更新がなければ何も出力しない（トークン節約）。
 *
 * Timeout: 10s
 * stdin: { session_id, cwd, prompt }
 */
import { getDb, closeDb } from "../db";
import { buildDiffContext } from "../lib/memory-injector";

async function main() {
  let input: {
    session_id?: string;
    cwd?: string;
    prompt?: string;
  } = {};

  try {
    const stdin = await Bun.stdin.text();
    if (stdin.trim()) {
      input = JSON.parse(stdin);
    }
  } catch {
    // No stdin or invalid JSON
  }

  const sessionId =
    input.session_id || process.env.CLAUDE_SESSION_ID || "unknown";
  const cwd =
    input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();

  try {
    const db = getDb();

    const xml = buildDiffContext(db, sessionId, cwd);
    if (xml) {
      process.stdout.write(xml);
    }

    closeDb();
  } catch (err) {
    process.stderr.write(
      `[session-memory:prompt-submit] Error: ${err}\n`
    );
  }
}

main();
