/**
 * claude-session-memory - Decision Extractor
 *
 * transcript のアシスタントメッセージから重要な決定を抽出する。
 */
import type { ParsedMessage } from "./transcript-parser";

export interface ExtractedDecision {
  decision: string;
  context: string;
  category: string;
}

// Decision indicator patterns
const DECISION_PATTERNS = [
  // Architecture/design decisions
  {
    pattern:
      /(?:decided to|chose to|going with|selected|the approach is|will use|switching to|migrating to|adopting)\s+(.{20,200})/gi,
    category: "architecture",
  },
  // Configuration changes
  {
    pattern:
      /(?:configured|set up|enabled|disabled|changed .+ to|updated .+ from .+ to)\s+(.{10,200})/gi,
    category: "config",
  },
  // Workflow decisions
  {
    pattern:
      /(?:workflow will|process changed to|now using|replaced .+ with)\s+(.{10,200})/gi,
    category: "workflow",
  },
  // Issue/PR decisions
  {
    pattern:
      /(?:created issue|opened PR|merged|closed issue|resolved by)\s+(.{10,150})/gi,
    category: "workflow",
  },
];

/**
 * Extract decisions from assistant messages.
 * Conservative approach: only explicit decision language.
 */
export function extractDecisions(
  messages: ParsedMessage[]
): ExtractedDecision[] {
  const assistantTexts = messages
    .filter((m) => m.role === "assistant" && m.content)
    .map((m) => m.content!);

  if (assistantTexts.length === 0) return [];

  const decisions: ExtractedDecision[] = [];
  const seen = new Set<string>();

  for (const text of assistantTexts) {
    for (const { pattern, category } of DECISION_PATTERNS) {
      // Reset lastIndex for global regex
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(text)) !== null) {
        const decision = match[0].trim();
        const normalized = decision.toLowerCase().slice(0, 50);

        // Deduplicate
        if (seen.has(normalized)) continue;
        seen.add(normalized);

        // Get surrounding context (up to 100 chars before match)
        const idx = text.indexOf(match[0]);
        const contextStart = Math.max(0, idx - 100);
        const context = text.slice(contextStart, idx).trim();

        decisions.push({
          decision: decision.slice(0, 300),
          context: context.slice(0, 200),
          category,
        });
      }
    }
  }

  // Cap at 10 decisions per session
  return decisions.slice(0, 10);
}
