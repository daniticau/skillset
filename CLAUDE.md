# skillset

Portable personalization layer for coding agents. A canonical skill store that mirrors SKILL.md files into each agent's native skills directory, with user-edit-aware sync.

## North star

A self-improving coding-agent harness. Your interactions with agents are the training data: when something goes wrong — a correction, a redo, a rejected plan — a background pass analyzes the signal and drafts a skill that would have prevented it. Skills live in a canonical store you own and mirror into whatever agent harness you use, so personalization follows you across tools rather than being trapped in any vendor's database.

See `VISION.md` for the full north star.

## Current scope

- **Sync engine**: canonical → mirror, with user-edits promoted back. Only `claude-code` is a writable mirror target today (Cursor/Codex adapters are stubbed).
- **Session scraping**: reads transcripts from Claude Code, Codex, and Cursor into `~/.skillset/sessions/` (SQLite). This is the mining input, not a mirror.
- **Mining pipeline**: heuristic + LLM extraction of "nuggets" (corrections, preferences, rejections, workflows, anti-patterns), semantic clustering, ranking.
- **Draft synthesis**: top clusters → draft SKILL.md files. User reviews with `drafts`, ships with `promote`.

Everything is manual-trigger today. No daemons, no auto-install tier.

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
- `src/core/mirror.ts` — sync engine
- `src/core/adapters/` — per-agent mirror targets. Only `claude-code` is writable today.
- `src/ingest/` — **forked from nia-cli** (MIT). Folder-walking utilities + per-agent session readers (`sessions/claudeCode.ts`, `codex.ts`, `cursor.ts`) that land transcripts in a SQLite store via `sessions/writer.ts` and `sessions/sqlite.ts`. Notable delta from upstream: `.jsonl` is in the TEXT_EXTENSIONS allowlist (upstream skips it, which would silently drop Claude Code conversations).
- `src/mine/` — signal extraction over scraped sessions.
  - `reader.ts` — reads sessions out of the scrape store
  - `chunker.ts` — conversation windowing for LLM context
  - `extract.ts` — heuristic nugget extraction (corrections, rejections, etc.)
  - `llm-extract.ts` + `llm/` — Ollama-backed LLM extraction and validation
  - `dedup.ts` — semantic clustering (embeddings when available, TF-IDF fallback) and ranking
  - `synthesize.ts` — turns top clusters into draft SKILL.md files in `~/.skillset/drafts/`
  - `state.ts` — per-session incremental-processing state (`MINE_PIPELINE_VERSION` tracks schema changes)

## CLI

Sync + store:
- `skillset init` — create the store, git-init it, and **auto-link any coding agents detected on disk** (pass `--no-auto-link` to skip). Detection is per-adapter (`adapter.detect()`).
- `skillset link <agent>` — manually register a mirror target (`--path` to override default)
- `skillset unlink <agent>`
- `skillset sync` — run the mirror engine
- `skillset status` — list links and skills, flag user-modified
- `skillset list` — list skills with descriptions

Mining pipeline:
- `skillset scrape` — pull session transcripts from Claude Code / Codex / Cursor into `~/.skillset/sessions/` (`--source` to pick one, `--full` to ignore incremental cursors)
- `skillset mine` — heuristic extraction of nuggets from scraped sessions. Flags: `--llm` (add Ollama-backed extraction), `--synthesize` (draft SKILL.md files from top clusters, implies `--llm`), `--project <slug>`, `--force`, `--dry-run`, `--verbose`
- `skillset drafts` — list pending draft skills; `--rm <name>` to discard
- `skillset promote <name>` — move a draft into the canonical store and sync (`--no-sync` to skip the sync step)
- `skillset doctor` — health check: store, LLM connectivity, mirror state, session data

## Design principles

- **User edits are sacred.** Any edit a user makes to a mirror's SKILL.md gets promoted to canonical. The system never overwrites a user edit silently.
- **One-way sync by default.** The canonical store is the source of truth. Mirrors are derived. Bidirectional merge is explicitly rejected.
- **No magic by default.** Sync, scrape, mine, and promote all run on demand. No background daemons. Skills only land in the canonical store after the user runs `promote`.
- **Mining proposes, the user disposes.** The pipeline generates drafts; shipping them is a deliberate action.

## Not yet built

- **Writable mirrors for Cursor / Codex / Copilot.** Session reading works for all three, but only Claude Code is a sync target. This is the biggest gap vs. the cross-agent portability promise in `VISION.md`.
- **Trust-tiered auto-install.** Everything requires manual `promote` today. A category-based "safe to auto-install" tier is on the roadmap.
- **Usefulness feedback loop.** No signal yet on whether promoted skills actually reduced friction. Needed to close the self-improvement loop.
- **Usefulness scoring / auto-prune** for stale or low-value skills.
- **Conflict resolution** for simultaneous edits in multiple mirrors (currently last-promoted wins).

## Dev

- `pnpm install`
- `pnpm build` — tsup bundles `src/cli.ts` to `dist/cli.js`
- `pnpm test` — vitest
- `pnpm typecheck`
