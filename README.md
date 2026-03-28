# claude-session-memory

**Claude Code Plugin** — 全セッションの会話ログを SQLite に自動保存し、次回起動時に過去コンテキストを自動注入する。

> "一度話したことは絶対に忘れない" 長期記憶を Claude Code に。

## Features

- **自動ログ保存**: 全セッションの transcript を SQLite に構造化保存（Hook で自動実行）
- **コンテキスト注入**: セッション開始時に過去の決定・知識を XML で自動注入
- **差分注入**: 2回目以降のプロンプトでは変更分のみ注入（トークン節約）
- **決定の記録**: アシスタントの重要な判断を自動抽出・検索可能に
- **SQL 検索**: 「このプロジェクトで過去に何を決めた？」を即座に検索
- **クロスプロジェクト**: 全プロジェクトの知識を1つの DB で横断管理

## Install

### Claude Code Plugin（推奨）

```bash
# 1. マーケットプレイスとして追加
/plugin marketplace add aieo-product/claude-session-memory

# 2. インストール
/plugin install claude-session-memory@aieo-product
```

### 手動インストール

```bash
# 1. クローン
git clone https://github.com/aieo-product/claude-session-memory.git ~/.claude/session-memory-plugin

# 2. hooks を ~/.claude/settings.json に追加（後述の Configuration 参照）
```

> **前提条件**: [bun](https://bun.sh) がインストールされていること

## How It Works

```
Claude Code Session
  │
  ├─ SessionStart hook ──→ DB にセッション作成
  │                        過去コンテキスト XML 注入 (stdout)
  │
  ├─ UserPromptSubmit ───→ 差分メモリ注入 (0 tokens if no changes)
  │
  └─ Stop hook (async) ──→ transcript JSONL パース
                           messages / decisions を DB 保存
                           セッション summary 自動生成
```

### コンテキスト注入イメージ

セッション起動時に、過去の情報が自動で会話に挿入される:

```xml
<session-memory source="session-memory" session="abc-123">
  <previous-session project="my-app" ended="2026-03-24T10:00:00Z">
    <summary>認証フローをJWTからセッションベースに変更した</summary>
  </previous-session>
  <recent-decisions count="2">
    <decision category="architecture">REST API → GraphQL に移行</decision>
    <decision category="config">ESLint flat config に統一</decision>
  </recent-decisions>
  <memory-blocks count="3">
    <block key="preference:test_framework">vitest を使用</block>
    <block key="pattern:error_handling">Result型パターンを採用</block>
  </memory-blocks>
</session-memory>
```

## SQLite Schema

DB 場所: `~/.claude/session-memory/memory.db`

| テーブル | 用途 |
|----------|------|
| `sessions` | セッション記録（project, branch, summary） |
| `messages` | ターン単位のメッセージ（role, content, tool_name） |
| `memory_blocks` | 永続的な知識 key-value（project-scoped or global） |
| `decisions` | 重要な決定の記録（category, resolved flag） |

## CLI

```bash
# プラグインパスを変数に設定（インストール方法に応じて変更）
PLUGIN_PATH=~/.claude/plugins/cache/aieo-product/claude-session-memory/*/

# DB 統計
bun $PLUGIN_PATH/scripts/cli.ts status

# セッション一覧
bun $PLUGIN_PATH/scripts/cli.ts sessions

# 決定一覧
bun $PLUGIN_PATH/scripts/cli.ts decisions

# 直接 SQL クエリ
bun $PLUGIN_PATH/scripts/cli.ts query "SELECT * FROM decisions WHERE category='architecture'"

# transcript 手動取り込み
bun $PLUGIN_PATH/scripts/cli.ts ingest <file.jsonl>
```

## Configuration

`~/.claude/session-memory/config.json` で設定をカスタマイズ（任意）:

```json
{
  "db_path": "~/.claude/session-memory/memory.db",
  "session_start": {
    "max_decisions": 5,
    "max_memory_blocks": 10,
    "include_last_summary": true
  },
  "stop": {
    "extract_decisions": true,
    "max_messages_stored": 1000
  },
  "retention": {
    "messages_days": 90,
    "sessions_days": 365,
    "decisions_days": null
  }
}
```

## Token Efficiency

| Phase | Injection | Description |
|-------|-----------|-------------|
| SessionStart | ~500-1500 tokens | Full context (past summary + decisions + memory) |
| UserPromptSubmit | 0-200 tokens | Diff only. 0 if no changes. |
| Stop | 0 tokens | No output (DB write only) |

## Architecture

### System Overview

```
Claude Code Session
  │
  ├─ [SessionStart]  ←── Hook (5s timeout)
  │   ├─ INSERT session record (project, branch, timestamp)
  │   ├─ SELECT past context (decisions, memory_blocks, last summary)
  │   └─ stdout → XML context injection (~500-1500 tokens)
  │
  ├─ [UserPromptSubmit]  ←── Hook (10s timeout)
  │   ├─ SELECT new memory_blocks since session start
  │   └─ stdout → diff XML (0-200 tokens, 0 if no changes)
  │
  └─ [Stop]  ←── Hook (120s, async)
      ├─ Stream-parse transcript JSONL
      ├─ INSERT messages (batch, max 1000/session)
      ├─ Extract decisions (regex: "decided to", "chose to", etc.)
      ├─ Generate session summary
      └─ UPDATE session (end_time, summary, counts)
```

### SQLite Schema (ER)

```
sessions 1──N messages
    │
    └── 1──N decisions

memory_blocks (independent, scoped by project)
```

```sql
-- sessions: one row per Claude Code session
sessions (
  id TEXT PRIMARY KEY,           -- session UUID
  project TEXT NOT NULL,         -- working directory
  project_name TEXT,             -- directory basename
  git_branch TEXT,
  start_time TEXT, end_time TEXT,
  summary TEXT,                  -- auto-generated
  message_count INTEGER, tool_use_count INTEGER
)

-- messages: parsed from transcript JSONL
messages (
  session_id TEXT REFERENCES sessions(id),
  role TEXT,                     -- 'user' | 'assistant'
  content TEXT,
  tool_name TEXT, tool_input TEXT, tool_result TEXT,
  timestamp TEXT
)

-- memory_blocks: persistent knowledge (key-value)
memory_blocks (
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  project TEXT,                  -- NULL = global scope
  category TEXT,                 -- 'general' | 'preference' | 'pattern' | 'decision'
  source_session_id TEXT,
  UNIQUE(key, project)
)

-- decisions: important choices extracted from assistant text
decisions (
  session_id TEXT REFERENCES sessions(id),
  decision TEXT, context TEXT, rationale TEXT,
  category TEXT,                 -- 'architecture' | 'config' | 'workflow'
  resolved INTEGER DEFAULT 0    -- 0=open, 1=resolved
)
```

**Indexes**: project, start_time, session_id, role, tool_name, timestamp, category, resolved

### Context Injection Format

**SessionStart (full injection)**:

```xml
<session-memory source="session-memory" session="..." injected_at="...">
  <previous-session project="my-app" ended="...">
    <summary>前回の要約</summary>
  </previous-session>
  <recent-decisions count="N">
    <decision id="..." category="architecture" timestamp="...">決定内容</decision>
  </recent-decisions>
  <memory-blocks count="N">
    <block key="..." category="..." updated="...">値</block>
  </memory-blocks>
</session-memory>
```

**UserPromptSubmit (diff only)**:

```xml
<session-memory-update since="...">
  <new-memory key="..." category="...">新しい知識</new-memory>
</session-memory-update>
```

### Decision Extraction

Stop hook でアシスタントのテキストから正規表現で判断を自動抽出:

| Pattern | Category |
|---------|----------|
| `decided to`, `chose to`, `going with`, `switching to` | architecture |
| `configured`, `enabled`, `disabled`, `changed X to` | config |
| `created issue`, `opened PR`, `merged` | workflow |

### Technical Choices

| Item | Choice | Reason |
|------|--------|--------|
| Runtime | bun | Built-in `bun:sqlite`, zero deps |
| SQLite mode | WAL | Concurrent reads across sessions |
| Injection | XML via stdout | Claude Code hook protocol |
| Transcript parse | Streaming | Memory-efficient for large JSONL |

### File Structure

```
claude-session-memory/          ← Plugin root
├── hooks/hooks.json            ← Hook definitions (3 hooks)
├── package.json
└── scripts/
    ├── db.ts                   ← SQLite connection + schema + WAL
    ├── cli.ts                  ← CLI (status/sessions/decisions/query/ingest)
    ├── hooks/
    │   ├── session-start.ts    ← Create session + inject context
    │   ├── session-stop.ts     ← Parse transcript + save to DB
    │   └── prompt-submit.ts    ← Diff injection
    └── lib/
        ├── config.ts           ← Config loader (~/.claude/session-memory/config.json)
        ├── memory-injector.ts  ← Build XML from DB queries
        ├── transcript-parser.ts ← JSONL stream parser
        └── decision-extractor.ts ← Regex-based decision extraction

~/.claude/session-memory/       ← Runtime data (created automatically)
├── memory.db                   ← SQLite DB (WAL mode)
└── config.json                 ← Optional user config
```

### Extensibility

**Vector search (future)**: Add sqlite-vss or ChromaDB for semantic search:

```sql
CREATE VIRTUAL TABLE message_embeddings USING vss0 (embedding(1536));
```

**Cross-project shared brain**: `memory_blocks` with `project = NULL` are global scope, shared across all projects.

## Inspired By

- [letta-ai/claude-subconscious](https://github.com/letta-ai/claude-subconscious) — Hooks + Letta agent approach
- Storage replaced with local SQLite for simplicity, searchability, and zero external dependencies.

## License

MIT
