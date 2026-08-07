# skillset

A macOS personalization layer for coding agents. skillset keeps one reusable skill library on disk, imports existing skills from the agent tools you already use, and mirrors every canonical skill to every connected harness automatically.

## Why

Every conversation with a coding agent contains signals about how you work: corrections, rejected plans, repeated preferences, tool choices, and workflows. skillset turns those signals into small `SKILL.md` files that follow you across Claude Code, Codex, Kimi Code, and Grok CLI instead of staying trapped in one vendor's memory.

## What It Does

- **Owns the source of truth** in `~/.skillset/skills/`.
- **Imports existing skills during setup** from connected agent stores and consolidates same-name conflicts by newest mtime, archiving older versions.
- **Mirrors automatically** after every command that changes canonical skills or connected mirrors.
- **Learns from history** with `sks tailor`: scrape sessions, mine recurring flaws/preferences, create or edit skills, then mirror them.
- **Supports a local-only review path** with `sks tailor --local`: scrape, mine, and rank candidates without sending transcript contents to an LLM or synthesizing skill changes.
- **Dreams nightly** with `sks dream`: install a macOS LaunchAgent that incrementally reviews new sessions, learns from agent mistakes and user preferences, tunes existing skills, and records reviewed/skipped days.
- **Captures explicit requests** with `sks tailor --stdin` or `sks tailor "prefer pnpm over npm"`.
- **Gives agents safe CLI CRUD** with `sks show`, `sks add`, `sks edit --stdin`, and `sks check`, without requiring a human editor or direct mirror writes.
- **Audits real skill use** from native Claude, Codex, and Kimi session records, including Kimi's durable `skill_activation` events.
- **Keeps manual edits safe** by promoting mirror-side edits before rewriting mirrors, while agent-created skills can opt into future tuning with `--managed`.
- **Includes a compact native desktop app** for live connection health, nightly reports, per-fix undo, settings, and full-text skill search.

## Desktop App

Skillset includes a native SwiftUI companion designed to stay in a compact quarter-screen window. It reads the same canonical store and uses the CLI for every mutation, so undo still reconciles every connected harness instead of creating app-only state.

```sh
pnpm app:install
```

The app provides:

- Live connection and mirror counts for every linked agent.
- A searchable skill library with descriptions, bodies, tiers, origins, and observed usage.
- Nightly reports explaining what was created, edited, merged, or pruned and why.
- One-button undo for each individual nightly fix. Undo stops safely when a skill has newer work.
- Nightly schedule, run-now, always-on-top, canonical-store, and refresh controls.

The app installs to `~/Applications/Skillset.app`. For a repo-local build only, run `pnpm app:build`.

## Install

```sh
npm install -g skillset-cli
sks init
```

`init` creates `~/.skillset`, detects supported coding agents, asks which stores to connect, imports their existing skills, and mirrors the consolidated store back out.

Today Skillset supports four first-class user skill roots:

- Claude: `~/.claude/skills`
- Codex: `~/.codex/skills`
- Kimi Code: `~/.kimi-code/skills`
- Grok CLI: `~/.grok/skills`

Skills are never assigned to a model. Connecting a harness adds another mirror of the entire canonical library; disconnecting it stops future sync without deleting its files.

Then run:

```sh
sks tailor
```

That one command scrapes past sessions, finds repeated agent mistakes or preferences, writes useful skills directly into canonical, and mirrors them to connected agents.

For a no-global-install trial, use the package runner for each command:

```sh
npx skillset-cli init
npx skillset-cli tailor
```

## Codex Plugin

This repo includes a thin Codex plugin at `plugins/skillset`. It teaches Codex when to use the existing `sks` CLI for capture, tailoring, inspection, and mirror repair.

The plugin assumes `sks` is installed or otherwise available on `PATH`. It does not add an MCP server or a second store; `~/.skillset/skills/` remains canonical.

Marketplace setup from GitHub:

```sh
codex plugin marketplace add daniticau/skillset
```

Local checkout setup:

```sh
codex plugin marketplace add /path/to/skillset
```

Start a new Codex thread and say:

```txt
Remember this as a reusable skill.
```

If Codex does not enable the plugin automatically, open `/plugins`, choose Skillset, and install it from the Skillset marketplace.

## Commands

| Command | What it does |
| --- | --- |
| `sks init` | First-run setup: create the store, connect detected agents, import existing skills, mirror back out. |
| `sks tailor [text...]` | Learn from past sessions, or turn explicit text/stdin into a skill. |
| `sks dream` | Install/update the macOS nightly improvement LaunchAgent. |
| `sks dream --run-now` | Run the nightly improvement immediately. |
| `sks dream --status` | Show the LaunchAgent state and reviewed/tailored days. |
| `sks list` | List current skills with short descriptions. |
| `sks show <skill>` | Print one canonical `SKILL.md`; use `--json` or `--path` for agent workflows. |
| `sks check [skill]` | Validate skills and flag weak discovery metadata, context bloat, or unmanaged nested skills. |
| `sks catalog` | Show all canonical skills grouped by likely use case, with origin, tier, and usage counts. |
| `sks status` | Show connected mirrors, skill state, user edits, and conflicts. Use `--usage` to include observed usage counts. |
| `sks usage` | Show observed skill usage counts and last-used dates. |
| `sks usage scan` | Infer skill usage from scraped sessions. |
| `sks usage record <skill>` | Manually record a high-confidence observed skill use. |
| `sks connect <agent>` | Connect an agent mirror and import/consolidate its existing skills. |
| `sks disconnect <agent>` | Disconnect an agent mirror without deleting its files. |
| `sks add [source]` | Add a complete skill directory/file, or pipe `SKILL.md` with `--stdin`; agents use `--managed` for tuneable additions. |
| `sks edit <skill>` | Edit interactively or replace with `--stdin`/`--source`; agents use `--managed` to avoid marking managed maintenance as a manual edit. |
| `sks remove <skill>` | Delete a canonical skill and prune it from connected mirrors. |
| `sks doctor` | Health check: store, LLM, mirrors, sessions, usage, and conflicts. |
| `sks doctor --repair` | Reconcile canonical skills with connected mirrors and mirror the result. |

Useful `tailor` flags:

```sh
sks tailor --dry-run
sks tailor --local
sks tailor --full
sks tailor --force
sks tailor --project my-project
sks tailor --max 5
sks tailor --stdin
```

Useful `dream` commands:

```sh
sks dream
sks dream --at 02:30
sks dream --run-now
sks dream --run-now --force
sks dream --status
sks dream --off
```

Useful `usage` commands:

```sh
sks usage
sks catalog
sks usage my-skill
sks usage scan --scrape
sks usage scan --force --project my-project
sks usage record my-skill --agent codex --project my-project
```

Agent-safe skill management:

```sh
sks show my-skill --json
sks check my-skill --json
sks add ./my-skill --managed
sks add --stdin --managed < ./SKILL.md
sks edit my-skill --stdin --managed < ./SKILL.md
sks edit my-skill --source ./my-skill --managed
```

## Architecture

```txt
~/.skillset/
  skills/             canonical SKILL.md directories
  config.json         { links: [{ agent, path }] }
  state.json          hashes, origins, user edits, conflict history, reviewed days
  sessions/           JSONL envelope store of scraped transcripts
  usage/events.jsonl  append-only observed skill usage events
  reports/            structured nightly reports and per-change undo state
  conflicts/          archived losing versions from mirror conflicts
  .git                version history of the canonical store
```

The canonical store is the source of truth. Mirrors are derived. Before writing a mirror, skillset compares the mirror's current hash to its recorded hash; if the user edited the mirror directly, skillset promotes that edit to canonical and then rewrites all connected mirrors from the updated canonical version.

Older Codex installs that used `~/.agents/skills` are migrated to `~/.codex/skills` when Codex Desktop is present. Kimi may also discover `~/.agents/skills`, but Skillset mirrors to Kimi's explicit brand root so ownership and parity remain inspectable. Skillset does not connect Cursor or other editor-specific stores.

## Trust Tiers

Generated skills keep a `tier:` in frontmatter:

- `high` - narrow style or single-fact preferences.
- `medium` - workflow and tool-routing rules.
- `low` - broader behavior changes.

All tiers install directly into canonical now. The tier remains useful metadata for future cleanup, scoring, and conservative automation.

## Principles

- **Your personalization is yours.** The canonical store is a git repo on your disk.
- **Automation is the default author.** Agent-created skills use `--managed` so later history can tune them.
- **Manual edits remain safe.** Mirror-side edits are promoted, never silently overwritten.
- **One-way mirrors.** Canonical writes to mirrors after reconciliation; no bidirectional merge UI.
- **No drafts.** Generated skills install directly; use `--dry-run`, `sks edit`, and `sks remove` to control changes.
- **Agent-operable public surface.** Agents can inspect, validate, add, and edit canonical skills non-interactively; every mutation still reconciles and mirrors automatically.

## Dev

```sh
pnpm install
pnpm check
pnpm app:build
pnpm build
pnpm test
pnpm typecheck
```

## License

[MIT](./LICENSE).

`src/ingest/` is forked from [nia-cli](https://github.com/trynia/nia-cli) (MIT). Notable deltas: `.jsonl` is in the text-extension allowlist, and dedicated readers understand Claude project logs, Codex rollouts, and Kimi main-agent wire records.
