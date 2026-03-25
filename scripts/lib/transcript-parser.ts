/**
 * claude-session-memory - Transcript JSONL Parser
 *
 * Claude Code の transcript JSONL をストリーミングパースし、
 * messages テーブルに挿入可能な形式に変換する。
 */
import { existsSync } from "node:fs";

export interface ParsedMessage {
  role: "user" | "assistant" | "system";
  content: string | null;
  tool_name: string | null;
  tool_input: string | null;
  tool_result: string | null;
  timestamp: string;
}

interface TranscriptEntry {
  type: string;
  uuid?: string;
  timestamp?: string;
  sessionId?: string;
  isMeta?: boolean;
  message?: {
    role: string;
    content: string | ContentBlock[];
  };
}

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  content?: string | ContentBlock[];
}

/**
 * Parse transcript JSONL file and return structured messages.
 * Streams line-by-line for memory efficiency.
 */
export async function parseTranscript(
  transcriptPath: string,
  maxMessages: number = 1000
): Promise<ParsedMessage[]> {
  if (!existsSync(transcriptPath)) {
    return [];
  }

  const file = Bun.file(transcriptPath);
  const text = await file.text();
  const lines = text.split("\n").filter((l) => l.trim());

  const messages: ParsedMessage[] = [];

  for (const line of lines) {
    if (messages.length >= maxMessages) break;

    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    // Skip non-message types
    if (!["user", "assistant"].includes(entry.type)) continue;

    // Skip meta messages (hook injections, system reminders)
    if (entry.isMeta) continue;

    const timestamp = entry.timestamp || new Date().toISOString();

    if (!entry.message?.content) continue;

    // Handle string content (simple user message)
    if (typeof entry.message.content === "string") {
      messages.push({
        role: entry.type as "user" | "assistant",
        content: entry.message.content,
        tool_name: null,
        tool_input: null,
        tool_result: null,
        timestamp,
      });
      continue;
    }

    // Handle array content blocks
    if (Array.isArray(entry.message.content)) {
      for (const block of entry.message.content) {
        if (block.type === "text" && block.text) {
          messages.push({
            role: entry.type as "user" | "assistant",
            content: block.text,
            tool_name: null,
            tool_input: null,
            tool_result: null,
            timestamp,
          });
        } else if (block.type === "tool_use" && block.name) {
          messages.push({
            role: "assistant",
            content: null,
            tool_name: block.name,
            tool_input: block.input
              ? JSON.stringify(block.input).slice(0, 2000)
              : null,
            tool_result: null,
            timestamp,
          });
        } else if (block.type === "tool_result") {
          const resultText =
            typeof block.content === "string"
              ? block.content
              : Array.isArray(block.content)
                ? block.content
                    .filter((c: ContentBlock) => c.type === "text")
                    .map((c: ContentBlock) => c.text)
                    .join("\n")
                : null;
          if (resultText && messages.length > 0) {
            // Attach to the most recent tool_use message
            const lastToolUse = [...messages]
              .reverse()
              .find((m) => m.tool_name && !m.tool_result);
            if (lastToolUse) {
              lastToolUse.tool_result = resultText.slice(0, 2000);
            }
          }
        }
        // Skip 'thinking' blocks to save space
      }
    }
  }

  return messages;
}

/**
 * Generate a simple session summary from parsed messages.
 * First user prompt + last assistant response, truncated.
 */
export function generateSummary(messages: ParsedMessage[]): string | null {
  const userMsgs = messages.filter(
    (m) => m.role === "user" && m.content
  );
  const assistantMsgs = messages.filter(
    (m) => m.role === "assistant" && m.content
  );

  if (userMsgs.length === 0) return null;

  const firstUser = userMsgs[0].content!.slice(0, 200);
  const lastAssistant = assistantMsgs.length > 0
    ? assistantMsgs[assistantMsgs.length - 1].content!.slice(0, 300)
    : "";

  const toolNames = [
    ...new Set(
      messages.filter((m) => m.tool_name).map((m) => m.tool_name!)
    ),
  ];
  const toolSummary =
    toolNames.length > 0 ? ` Tools: ${toolNames.join(", ")}` : "";

  return `User: ${firstUser}${lastAssistant ? ` → Assistant: ${lastAssistant}` : ""}${toolSummary}`.slice(
    0,
    500
  );
}
