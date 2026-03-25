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

```
~/.claude/
├── session-memory/
│   ├── memory.db        ← SQLite (WAL mode)
│   └── config.json      ← Optional config
│
claude-session-memory/     ← This repo (plugin root)
├── hooks/hooks.json       ← Hook definitions
├── package.json
└── scripts/
    ├── db.ts              ← DB connection + schema
    ├── cli.ts             ← CLI tool
    ├── hooks/
    │   ├── session-start.ts
    │   ├── session-stop.ts
    │   └── prompt-submit.ts
    └── lib/
        ├── config.ts
        ├── memory-injector.ts
        ├── transcript-parser.ts
        └── decision-extractor.ts
```

## Inspired By

- [letta-ai/claude-subconscious](https://github.com/letta-ai/claude-subconscious) — Hooks + Letta agent approach
- Storage replaced with local SQLite for simplicity, searchability, and zero external dependencies.

## License

MIT
