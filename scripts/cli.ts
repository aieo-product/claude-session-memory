/**
 * claude-session-memory - CLI Tool
 *
 * Usage:
 *   bun scripts/cli.ts status
 *   bun scripts/cli.ts sessions [limit]
 *   bun scripts/cli.ts decisions [project]
 *   bun scripts/cli.ts memory [project]
 *   bun scripts/cli.ts query "SELECT ..."
 *   bun scripts/cli.ts ingest <transcript.jsonl> [session_id]
 */
import { getDb, closeDb } from "./db";

const args = process.argv.slice(2);
const command = args[0] || "status";

const db = getDb();

switch (command) {
  case "status": {
    const sessions = db
      .query("SELECT count(*) as c FROM sessions")
      .get() as { c: number };
    const messages = db
      .query("SELECT count(*) as c FROM messages")
      .get() as { c: number };
    const decisions = db
      .query("SELECT count(*) as c FROM decisions")
      .get() as { c: number };
    const blocks = db
      .query("SELECT count(*) as c FROM memory_blocks")
      .get() as { c: number };

    console.log("=== claude-session-memory Status ===");
    console.log(`Sessions:  ${sessions.c}`);
    console.log(`Messages:  ${messages.c}`);
    console.log(`Decisions: ${decisions.c}`);
    console.log(`Memory:    ${blocks.c}`);
    break;
  }

  case "sessions": {
    const limit = Number.parseInt(args[1] || "10", 10);
    const rows = db
      .query(
        `SELECT id, project_name, git_branch, start_time, end_time,
                message_count, tool_use_count, substr(summary, 1, 100) as summary
         FROM sessions ORDER BY start_time DESC LIMIT ?`
      )
      .all(limit);
    console.table(rows);
    break;
  }

  case "decisions": {
    const project = args[1];
    const rows = project
      ? db
          .query(
            `SELECT d.id, d.decision, d.category, d.resolved, d.timestamp
             FROM decisions d
             JOIN sessions s ON d.session_id = s.id
             WHERE s.project LIKE ?
             ORDER BY d.timestamp DESC LIMIT 20`
          )
          .all(`%${project}%`)
      : db
          .query(
            "SELECT id, decision, category, resolved, timestamp FROM decisions ORDER BY timestamp DESC LIMIT 20"
          )
          .all();
    console.table(rows);
    break;
  }

  case "memory": {
    const project = args[1];
    const rows = project
      ? db
          .query(
            "SELECT key, substr(value, 1, 80) as value, category, updated_at FROM memory_blocks WHERE project LIKE ? OR project IS NULL ORDER BY updated_at DESC"
          )
          .all(`%${project}%`)
      : db
          .query(
            "SELECT key, substr(value, 1, 80) as value, project, category, updated_at FROM memory_blocks ORDER BY updated_at DESC LIMIT 20"
          )
          .all();
    console.table(rows);
    break;
  }

  case "query": {
    const sql = args[1];
    if (!sql) {
      console.error("Usage: cli.ts query \"SELECT ...\"");
      process.exit(1);
    }
    try {
      const rows = db.query(sql).all();
      console.log(JSON.stringify(rows, null, 2));
    } catch (err) {
      console.error("Query error:", err);
    }
    break;
  }

  case "ingest": {
    const transcriptPath = args[1];
    const sessionId = args[2] || `ingest-${Date.now()}`;
    if (!transcriptPath) {
      console.error("Usage: cli.ts ingest <transcript.jsonl> [session_id]");
      process.exit(1);
    }

    // Dynamically import and run stop hook logic
    const { parseTranscript, generateSummary } = await import(
      "./lib/transcript-parser"
    );
    const { extractDecisions } = await import(
      "./lib/decision-extractor"
    );

    // Ensure session exists
    db.run(
      `INSERT OR IGNORE INTO sessions (id, project, project_name, start_time)
       VALUES (?, ?, ?, ?)`,
      [sessionId, process.cwd(), "manual-ingest", new Date().toISOString()]
    );

    const messages = await parseTranscript(transcriptPath, 1000);
    console.log(`Parsed ${messages.length} messages`);

    const insertMsg = db.prepare(
      `INSERT INTO messages (session_id, role, content, tool_name, tool_input, tool_result, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const batch = db.transaction((msgs: typeof messages) => {
      for (const m of msgs) {
        insertMsg.run(sessionId, m.role, m.content, m.tool_name, m.tool_input, m.tool_result, m.timestamp);
      }
    });
    batch(messages);

    const decisions = extractDecisions(messages);
    console.log(`Extracted ${decisions.length} decisions`);

    const summary = generateSummary(messages);
    db.run(
      "UPDATE sessions SET end_time = ?, summary = ?, message_count = ?, tool_use_count = ? WHERE id = ?",
      [new Date().toISOString(), summary, messages.length, messages.filter((m) => m.tool_name).length, sessionId]
    );

    console.log("Ingestion complete.");
    break;
  }

  default:
    console.error(
      `Unknown command: ${command}\nAvailable: status, sessions, decisions, memory, query, ingest`
    );
    process.exit(1);
}

closeDb();
