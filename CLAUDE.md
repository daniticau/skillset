# skillset

Portable personalization layer for coding agents. A canonical `SKILL.md` store mirrors into each connected agent's native skills directory, with user-edit-aware reconciliation.

## North Star

A self-improving coding-agent harness. Corrections, redos, rejected plans, and recurring preferences from agent sessions become reusable skills. Skills live in a canonical store the user owns and mirror into whatever agent harness they use.

See `VISION.md` for the full north star.

## Current Scope

- **Store + mirroring**: canonical `~/.skillset/skills/` is source of truth; connected mirrors are rewritten automatically after mutations.
- **Initial consolidation**: `sks init` and `sks connect` import existing skills from mirrors before writing to them.
- **Session scraping**: reads Claude Code and Codex transcripts into `~/.skillset/sessions/` as mining input.
- **Tailoring pipeline**: `sks tailor` scrapes sessions, mines nuggets, clusters/ranks them, asks the LLM to create/edit skills, and mirrors changes.
- **Explicit capture**: `sks tailor --stdin` or `sks tailor "<rule>"` turns a direct instruction into a user-owned skill.

No draft/promote flow. Generated skills write directly to canonical and then mirror.

## Architecture

```txt
~/.skillset/
  skills/             canonical SKILL.md directories
  config.json         { links: [{ agent, path }] }
  state.json          hashes, origins, user edits, conflict history
  sessions/           scraped transcript envelopes
  usage/events.jsonl  observed skill usage events
  conflicts/          archived losing versions from mirror conflicts
  .git                version history of the canonical store
```

Before writing mirrors, skillset checks recorded mirror hashes. If a mirror changed since the last write, that edit is promoted to canonical first. If multiple mirrors diverge, newest mtime wins and older versions are archived to `~/.skillset/conflicts/`.

## Core Modules

- `src/core/paths.ts` - well-known paths.
- `src/core/config.ts` - config/state JSON read/write and migrations.
- `src/core/skill.ts` - parse/validate/render/hash skills.
- `src/core/store.ts` - canonical store operations.
- `src/core/mirror.ts` - import, conflict resolution, mirror reconciliation.
- `src/core/adapters/` - agent mirror adapters.
- `src/ingest/` - session readers and JSONL envelope writers.
- `src/mine/` - extraction, clustering, LLM triage, synthesis, cleanup helpers.
- `src/commands/` - public command wrappers.

## Public CLI

- `sks init` - create store, connect detected agents, import existing skills, mirror back out.
- `sks tailor [text...]` - learn from history or capture explicit text/stdin as a skill.
- `sks list` - list current skills and descriptions.
- `sks status` - show connected mirrors and skill state.
- `sks connect <agent> [--path <path>]` - connect/import/mirror an agent.
- `sks disconnect <agent> [--path <path>]` - disconnect without deleting mirror files.
- `sks edit <skill>` - edit canonical skill via `$VISUAL`/`$EDITOR`, validate, mirror.
- `sks remove <skill>` - delete canonical skill and prune mirrors.
- `sks doctor [--repair]` - inspect health; `--repair` reconciles mirrors.

Internal modules for older flows may still exist while the codebase settles, but they are not public CLI surface.

## Design Principles

- **User edits are sacred.** Mirror-side edits are promoted, never silently overwritten.
- **Canonical owns delivery.** Mirrors are derived after reconciliation.
- **Automatic mirroring after mutations.** No user-facing `sync` command.
- **No drafts.** New skills install directly with tier metadata.
- **Recoverable conflicts.** Newest mtime wins; losing bodies and context are archived.

## Trust Tiers

LLM-created skills keep a frontmatter `tier:`:

- `high` - narrow style/single-fact preferences.
- `medium` - workflow and tool-routing rules.
- `low` - broad behavior changes.
- missing - legacy skills; preserve untouched.

All tiers install directly. Tier metadata is retained for conservative future cleanup/scoring.

## Dev

- `pnpm install`
- `pnpm build` - tsup bundles `src/cli.ts` to `dist/cli.js`
- `pnpm test` - vitest
- `pnpm typecheck`
