/**
 * claude-session-memory - Stop Hook (async)
 *
 * 1. transcript JSONL をパース
 * 2. messages を DB に保存
 * 3. decisions を抽出・保存
 * 4. session summary を生成
 *
 * Timeout: 120s (async)
 * stdin: { session_id, cwd, transcript_path }
 */
import { getDb, closeDb } from "../db";
import { getConfig } from "../lib/config";
import {
  parseTranscript,
  generateSummary,
} from "../lib/transcript-parser";
import { extractDecisions } from "../lib/decision-extractor";

async function main() {
  let input: {
    session_id?: string;
    cwd?: string;
    transcript_path?: string;
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

  // Resolve transcript path
  let transcriptPath = input.transcript_path || "";
  if (!transcriptPath) {
    // Try default Claude Code transcript location
    const home = process.env.HOME || "";
    const projectSlug = cwd.replace(/\//g, "-").replace(/^-/, "");
    transcriptPath = `${home}/.claude/projects/${projectSlug}/${sessionId}.jsonl`;
  }

  try {
    const config = getConfig();
    const db = getDb();

    // 1. Parse transcript
    const messages = await parseTranscript(
      transcriptPath,
      config.stop.max_messages_stored
    );

    if (messages.length === 0) {
      // No messages to process — just close the session
      db.run(
        "UPDATE sessions SET end_time = ? WHERE id = ?",
        [new Date().toISOString(), sessionId]
      );
      closeDb();
      return;
    }

    // 2. Insert messages in batch
    const insertMsg = db.prepare(
      `INSERT INTO messages (session_id, role, content, tool_name, tool_input, tool_result, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    const insertBatch = db.transaction((msgs: typeof messages) => {
      for (const m of msgs) {
        insertMsg.run(
          sessionId,
          m.role,
          m.content,
          m.tool_name,
          m.tool_input,
          m.tool_result,
          m.timestamp
        );
      }
    });

    insertBatch(messages);

    // 3. Extract and save decisions
    if (config.stop.extract_decisions) {
      const decisions = extractDecisions(messages);

      if (decisions.length > 0) {
        const insertDecision = db.prepare(
          `INSERT INTO decisions (session_id, decision, context, category)
           VALUES (?, ?, ?, ?)`
        );
        for (const d of decisions) {
          insertDecision.run(sessionId, d.decision, d.context, d.category);
        }
      }
    }

    // 4. Generate summary and update session
    const summary = generateSummary(messages);
    const toolCount = messages.filter((m) => m.tool_name).length;

    db.run(
      `UPDATE sessions
       SET end_time = ?, summary = ?, message_count = ?, tool_use_count = ?
       WHERE id = ?`,
      [
        new Date().toISOString(),
        summary,
        messages.length,
        toolCount,
        sessionId,
      ]
    );

    closeDb();
  } catch (err) {
    process.stderr.write(
      `[session-memory:session-stop] Error: ${err}\n`
    );
  }
}

main();
