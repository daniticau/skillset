# skillset

Portable personalization layer for coding agents. A canonical skill store that mirrors SKILL.md files into each agent's native skills directory, with user-edit-aware sync.

## North star

Cross-agent personalization. If you swap from Claude Code to Cursor to Codex mid-day, your skills follow you. You edit them in any mirror; skillset promotes edits back to the canonical store on next sync.

v1 is **sync-only, Claude Code only**. No mining, no scoring, no proactivity. The goal is to prove the architecture: a canonical store + a mirror adapter + user-edits-as-first-class signal.

## Architecture

```
~/.skillset/
  skills/             canonical SKILL.md directories (source of truth)
  config.json         { links: [{ agent, path }] }
  state.json          per-skill hashes (used to detect mirror-side edits)
  .git                version history of the canonical store
```

Sync is **one-way canonical → mirror**, with an exception: before writing a mirror, skillset compares the mirror's current hash to its recorded hash. If they differ, the user edited the mirror directly — skillset promotes the mirror version to canonical and marks the skill `userModified`. Then all mirrors are rewritten from the updated canonical.

## Core modules

- `src/core/paths.ts` — well-known paths (`~/.skillset/`, `~/.claude/skills/`)
- `src/core/config.ts` — JSON read/write for config + state
- `src/core/skill.ts` — parse/validate SKILL.md, hash skill directories
- `src/core/store.ts` — canonical store operations
- `src/core/mirror.ts` — sync engine (the only interesting logic)
- `src/core/adapters/` — per-agent mirror targets. Only `claude-code` in v1.
- `src/ingest/` — **forked from nia-cli** (MIT). Provides `discoverClaudeCodeHistory()` and `extractFolderIncremental()` for reading local session transcripts. No CLI command uses this yet — it's infrastructure for the future mining layer. Notable delta from upstream: `.jsonl` is in the TEXT_EXTENSIONS allowlist (upstream skips it, which would silently drop Claude Code conversations).

## CLI

- `skillset init` — create the store, git-init it, and **auto-link any coding agents detected on disk** (pass `--no-auto-link` to skip). Detection is per-adapter (`adapter.detect()`).
- `skillset link <agent>` — manually register a mirror target (`--path` to override default)
- `skillset unlink <agent>`
- `skillset sync` — run the mirror engine
- `skillset status` — list links and skills, flag user-modified
- `skillset list` — list skills with descriptions

## Design principles

- **User edits are sacred.** Any edit a user makes to a mirror's SKILL.md gets promoted to canonical. The system never overwrites a user edit silently.
- **One-way sync by default.** The canonical store is the source of truth. Mirrors are derived. Bidirectional merge is explicitly rejected for v1.
- **No magic.** `sync` is run manually. No background daemons, no auto-proactive suggestions. v1 is the skeleton.
- **Mining is a future layer.** Session scraping, plan-rejection signal mining, and the usefulness scorer live above this layer. They produce candidate skills; the sync layer distributes them.

## What v1 deliberately does NOT do

- Session mining / auto-generated skills
- Multi-agent adapters (Cursor, Codex, Copilot — stubbed in types, not implemented)
- Usefulness scoring / auto-prune
- Background/proactive behavior
- Conflict resolution for simultaneous edits in multiple mirrors (last-promoted wins)

## Dev

- `pnpm install`
- `pnpm build` — tsup bundles `src/cli.ts` to `dist/cli.js`
- `pnpm test` — vitest
- `pnpm typecheck`
