# skillset

Portable personalization layer for coding agents. A canonical `SKILL.md` store mirrors into each connected agent's native skills directory, with user-edit-aware reconciliation.

## North Star

Skillset is two things. Nothing else belongs in it.

1. **The canonical store.** One place that holds every skill, mirrored into
   every coding agent the user runs. One library, one name, every agent.
2. **A skill builder.** An efficient way to author and edit skills — in the CLI
   and in the app — turning the user's expertise into small, composable units.

A skill earns its place only if it encodes something an agent **cannot derive on
its own** — a private tool, a personal preference, a hard-won workflow, a
judgement algorithm the user invented.

There is no session mining, no nightly loop, and no background process. Skillset
runs when the user runs it.

## Current Scope

- **Five agents**: Claude Code, Codex, Kimi Code, Grok, and Cursor. Skills that ship with an agent (`vendorSkills` on the adapter) are surfaced but never adopted or deleted.
- **Plus one generic mirror**: `agents` targets `~/.agents/skills`, the vendor-neutral directory some agents read in addition to their own (Kimi Code scans it as a lower-precedence user root). It covers convention-following agents without a dedicated adapter each.
- **Store + mirroring**: canonical `~/.skillset/skills/` is source of truth; connected mirrors are rewritten automatically after mutations.
- **Always-on rules**: a skill with `always: true` is also rendered into a managed block (`<!-- skillset:always:start/end -->`) of each agent's global instructions file, derived from the skills root (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, …). Text outside the block is never touched. `sks always <skill> [--off]` flips it. Cursor has no such file.
- **Add from anywhere**: `sks add` accepts a local path, stdin, `owner/repo`, a GitHub repo/tree/blob URL, a raw `SKILL.md` URL, a skills.sh page, or a tweet that links to one of those (`src/core/remote.ts`). `--skill` picks one from a multi-skill repo; `--build` turns a link-less tweet's text into a skill via the builder.
- **Initial consolidation**: `sks init` and `sks connect` import existing skills from mirrors before writing to them.
- **Authoring**: `sks build "<idea>"` decomposes an idea into the smallest reusable skills, validates each against `sks check`, and installs only what passes. `sks add` / `sks edit` / `sks remove` cover direct management.
- **Desktop app**: one window. The sidebar lists every skill (search, kind shown as a faint row tint); the detail pane shows the selected skill for reading or editing (name, description, body), or the builder after **New skill**. Settings is a native Settings window (agents, editor, store path).
- **Version history**: every mutation commits the canonical store, so nothing is unrecoverable.
- **Pluggable LLM provider**: `claude-cli`, `codex-cli`, `kimi-cli`, `grok-cli`, `anthropic`, or `ollama`, auto-detected and overridable with `SKILLSET_LLM_PROVIDER` in `~/.skillset/.env`. Availability probes run a real completion, so a signed-out CLI reports unreachable instead of looking healthy.

## Architecture

```txt
~/.skillset/
  skills/             canonical SKILL.md directories
  config.json         { links: [{ agent, path }], ignore: [skillName] }
  state.json          hashes, origins, user edits, conflict history
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
- `src/core/adapters/` - agent mirror adapters; `always-block.ts` renders and splices the always-on block.
- `src/core/remote.ts` - resolve a URL / `owner/repo` / tweet into a local skill dir (injectable `fetch`).
- `src/build/decompose.ts` - splits a raw idea into the smallest reusable skills.
- `src/llm/` - provider adapters (one file per CLI/API backend).
- `src/commands/` - public command wrappers.
- `src/desktop/` - JSON snapshot backend consumed by the app. `sks desktop save` takes `{ name, rename?, description?, body? }` on stdin so the app never composes frontmatter.
- `desktop/` - native SwiftUI app and bundle scripts.

## Public CLI

- `sks init` - create store, connect detected agents, import existing skills, mirror back out.
- `sks build [idea...]` - decompose an idea into the smallest reusable skills and install them. `--json` previews; `--from-json` installs an already-reviewed proposal.
- `sks list` / `sks catalog` - list skills, flat or grouped by kind.
- `sks show <skill>` - inspect one canonical skill.
- `sks check [skill]` - validate structure, triggering metadata, and context size.
- `sks status` - show connected mirrors and skill state.
- `sks connect <agent>` / `sks disconnect <agent>` - manage mirrors.
- `sks add [source]` / `sks edit <skill>` / `sks rename <skill> <new-name>` / `sks remove <skill> [--block]` - manage skills.
- `sks always <skill> [--off]` - toggle always-on.
- `sks doctor [--repair [--store <path>]]` - inspect health; `--repair` relinks a moved store, then reconciles mirrors.

## Design Principles

- **Agent-created skills are first-class.** Managed additions and edits remain eligible for history-driven tuning.
- **Manual edits remain safe.** Mirror-side edits are promoted, never silently overwritten.
- **Canonical owns delivery.** Mirrors are derived after reconciliation.
- **Automatic mirroring after mutations.** No user-facing `sync` command.
- **No drafts.** New skills install directly with tier metadata.
- **Recoverable conflicts.** Newest mtime wins; losing bodies and context are archived.
- **Never delete what skillset did not write.** A mirror skill is pruned only when state holds a recorded hash proving skillset put it there. Skills the user installed into an agent themselves (including symlinked ones) are adopted or ignored, never removed.
- **Symlinked skills are first-class.** Skills are commonly linked in from a repo or an app bundle. Listing follows links, copies dereference into real content, and a recursive delete never follows a link out of the store.
- **Sync is crash-isolated.** One unreadable skill is reported in `SyncReport.failures`; it never aborts the pass and leaves state unwritten.
- **A missing store never prunes.** If `~/.skillset/skills` is gone but `state.json` still tracks skills, `sync()` throws instead of treating every mirror copy as stale. `sks doctor --repair` finds and relinks the folder.

## Skill Kinds

Skills are grouped by the kind of knowledge they carry, not by topic — that is
how you reach for one. `sks catalog`, the desktop Library filter, and `sks build`
all use the same four words:

- `Tool` - how to drive a specific piece of software or CLI.
- `Workflow` - ordered steps for a task.
- `Judgement` - an algorithm for deciding or evaluating.
- `Rule` - a durable constraint to respect.

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
- `pnpm cli:link` - write `~/.local/bin/sks` for this checkout; rerun after moving the repo
- `pnpm app:build`
- `pnpm app:install`
- App snapshot without screen-recording permission: `SKILLSET_SNAPSHOT_PATH=/tmp/app.png SKILLSET_SNAPSHOT_STATE=edit SKILLSET_SNAPSHOT_QUIT=1 desktop/build/Skillset.app/Contents/MacOS/Skillset` (states: `edit`, `edit-type`, `builder`, `settings`; `SKILLSET_SNAPSHOT_APPEARANCE=light|dark`). See `desktop/Sources/SkillsetApp/DebugSnapshot.swift`.
