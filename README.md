# skillset

A portable personalization layer for coding agents. skillset keeps your reusable agent skills in a canonical store on disk, imports existing skills from the agent tools you already use, and mirrors the consolidated store back out automatically.

## Why

Every conversation with a coding agent contains signals about how you work: corrections, rejected plans, repeated preferences, tool choices, and workflows. skillset turns those signals into small `SKILL.md` files that follow you across Codex, Claude Code, Cursor, and future agents instead of staying trapped in one vendor's memory.

## What It Does

- **Owns the source of truth** in `~/.skillset/skills/`.
- **Imports existing skills during setup** from connected agent stores and consolidates same-name conflicts by newest mtime, archiving older versions.
- **Mirrors automatically** after every command that changes canonical skills or connected mirrors.
- **Learns from history** with `sks tailor`: scrape sessions, mine recurring flaws/preferences, create or edit skills, then mirror them.
- **Captures explicit requests** with `sks tailor --stdin` or `sks tailor "prefer pnpm over npm"`.
- **Protects user edits** by promoting mirror-side edits back to canonical before rewriting mirrors.

## Try It In One Step

```sh
npx skillset-cli init
```

`init` creates `~/.skillset`, detects supported coding agents, asks which stores to connect, imports their existing skills, and mirrors the consolidated store back out.

Then run:

```sh
sks tailor
```

That one command scrapes past sessions, finds repeated agent mistakes or preferences, writes useful skills directly into canonical, and mirrors them to connected agents.

## Commands

| Command | What it does |
| --- | --- |
| `sks init` | First-run setup: create the store, connect detected agents, import existing skills, mirror back out. |
| `sks tailor [text...]` | Learn from past sessions, or turn explicit text/stdin into a skill. |
| `sks list` | List current skills with short descriptions. |
| `sks status` | Show connected mirrors, skill state, user edits, and conflicts. |
| `sks connect <agent>` | Connect an agent mirror and import/consolidate its existing skills. |
| `sks disconnect <agent>` | Disconnect an agent mirror without deleting its files. |
| `sks edit <skill>` | Open a canonical skill in `$VISUAL` or `$EDITOR`, validate, and mirror changes. |
| `sks remove <skill>` | Delete a canonical skill and prune it from connected mirrors. |
| `sks doctor` | Health check: store, LLM, mirrors, sessions, usage, and conflicts. |
| `sks doctor --repair` | Reconcile canonical skills with connected mirrors and mirror the result. |

Useful `tailor` flags:

```sh
sks tailor --dry-run
sks tailor --full
sks tailor --force
sks tailor --project my-project
sks tailor --max 5
sks tailor --stdin
```

## Architecture

```txt
~/.skillset/
  skills/             canonical SKILL.md directories
  config.json         { links: [{ agent, path }] }
  state.json          hashes, origins, user edits, conflict history
  sessions/           JSONL envelope store of scraped transcripts
  usage/events.jsonl  append-only observed skill usage events
  conflicts/          archived losing versions from mirror conflicts
  .git                version history of the canonical store
```

The canonical store is the source of truth. Mirrors are derived. Before writing a mirror, skillset compares the mirror's current hash to its recorded hash; if the user edited the mirror directly, skillset promotes that edit to canonical and then rewrites all connected mirrors from the updated canonical version.

## Trust Tiers

Generated skills keep a `tier:` in frontmatter:

- `high` - narrow style or single-fact preferences.
- `medium` - workflow and tool-routing rules.
- `low` - broader behavior changes.

All tiers install directly into canonical now. The tier remains useful metadata for future cleanup, scoring, and conservative automation.

## Principles

- **Your personalization is yours.** The canonical store is a git repo on your disk.
- **User edits are sacred.** Mirror-side edits are promoted, never silently overwritten.
- **One-way mirrors.** Canonical writes to mirrors after reconciliation; no bidirectional merge UI.
- **No drafts.** Generated skills install directly; use `--dry-run`, `sks edit`, and `sks remove` to control changes.
- **Small public surface.** `init`, `tailor`, `list`, `status`, `connect`, `disconnect`, `edit`, `remove`, `doctor`.

## Dev

```sh
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

## License

[MIT](./LICENSE).

`src/ingest/` is forked from [nia-cli](https://github.com/trynia/nia-cli) (MIT). Notable delta: `.jsonl` is in the text-extension allowlist so Codex conversations are not silently skipped.
