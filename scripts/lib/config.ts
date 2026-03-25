/**
 * claude-session-memory — Configuration
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface SessionMemoryConfig {
  enabled: boolean;
  db_path: string;
  session_start: {
    max_decisions: number;
    max_memory_blocks: number;
    include_last_summary: boolean;
  };
  stop: {
    extract_decisions: boolean;
    max_messages_stored: number;
  };
  retention: {
    messages_days: number;
    sessions_days: number;
    decisions_days: number | null;
  };
}

const DEFAULT_CONFIG: SessionMemoryConfig = {
  enabled: true,
  db_path: "~/.claude/session-memory/memory.db",
  session_start: {
    max_decisions: 5,
    max_memory_blocks: 10,
    include_last_summary: true,
  },
  stop: {
    extract_decisions: true,
    max_messages_stored: 1000,
  },
  retention: {
    messages_days: 90,
    sessions_days: 365,
    decisions_days: null,
  },
};

let _config: SessionMemoryConfig | null = null;

export function getConfig(): SessionMemoryConfig {
  if (_config) return _config;

  const home = process.env.HOME || "";
  const configPath = resolve(home, ".claude/session-memory/config.json");

  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(content);
      _config = mergeDeep(DEFAULT_CONFIG, parsed) as SessionMemoryConfig;
      return _config;
    } catch {
      // Fall through to defaults
    }
  }

  _config = DEFAULT_CONFIG;
  return _config;
}

function mergeDeep(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object"
    ) {
      result[key] = mergeDeep(
        target[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>
      );
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/** Project name from path (last directory segment) */
export function getProjectName(cwd: string): string {
  return cwd.split("/").filter(Boolean).pop() || "unknown";
}

/** Current git branch */
export function getGitBranch(cwd: string): string | null {
  try {
    const proc = Bun.spawnSync(
      ["git", "rev-parse", "--abbrev-ref", "HEAD"],
      { cwd, stdout: "pipe", stderr: "pipe" }
    );
    return proc.stdout.toString().trim() || null;
  } catch {
    return null;
  }
}
