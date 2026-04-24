# skillset

A portable personalization layer for coding agents. A canonical skill store that lives on your disk, mirrors into whichever agent harness you use, and gets better at you the more you use it.

> **Status: alpha.** Windows and Claude Code are the only first-class targets today. Cursor and Codex sessions are scraped for mining but their mirrors are read-only stubs. macOS and Linux support are planned.

## Why

Every conversation you have with a coding agent is training data about you: your stack, your taste, your pet peeves, the recurring mistakes your agent keeps making. Almost none of it gets captured. You correct the same things on Monday that you corrected on Friday. You switch from Claude Code to Cursor for an afternoon and start from zero.

skillset watches the transcripts your agents already write, mines them for friction (corrections, rejected plans, redos, preferences), drafts small skills that would have prevented the friction, and mirrors those skills into every agent you've linked. The canonical store is a git repo you own. Any agent that wants the rules is a mirror, not an owner.

## What it does today

- **One-way sync, canonical to mirror**, with user-edit promotion. Edit a skill directly inside `~/.claude/skills/` and the change gets promoted back to canonical before the next sync.
- **Session scraping** from Claude Code, Codex, and Cursor into `~/.skillset/sessions/` (SQLite).
- **Heuristic + LLM mining** of corrections, preferences, rejections, workflows, anti-patterns.
- **Draft synthesis, review, promote** flow. Nothing auto-installs unless you mark it safe.
- **Nightly cycle** via Windows Task Scheduler. Idle-gated: if you're still at the keyboard at 2am, the cycle waits until the next night.
- **Trust tiers**: every auto-generated skill is labeled `high`, `medium`, or `low`. High tier auto-installs silently, medium with a notice, low stays in drafts until you approve it.

## Quickstart

```
pnpm install
pnpm build
node dist/cli.js init
```

`init` is interactive. It detects coding agents you have installed, links them, offers to register the nightly scheduled task, and offers to run a one-off deep-dive over your full session history.

Typical first pass:

```
sks init          # setup + link + schedule
sks deep-dive     # mine everything on disk (resumable)
sks drafts        # review what was generated
sks promote <name>  # ship a draft into canonical + all mirrors
```

## The daily loop

1. You work with your agents normally.
2. At 2am, if the machine is idle, the cycle scrapes the day's new sessions, mines for signal, drafts zero-to-three new skills, runs a cleanup pass (dedup, conflict resolution, stale pruning), syncs to every mirror, and commits the result to the canonical store's internal git log.
3. Wake up. Your harness is a little better at you than it was yesterday.

Full write-up in [VISION.md](./VISION.md).

## Commands

| Command | What it does |
| --- | --- |
| `init` | First-run setup. Links agents, installs scheduler, optionally runs deep-dive. |
| `link <agent>` / `unlink <agent>` | Register or remove a mirror target (`claude-code`, `cursor`, `codex`). |
| `sync` | Canonical to mirrors, with user-edit promotion. |
| `status` | Linked mirrors, skill state, flagged user-modified skills. |
| `list` | Skills in the canonical store with descriptions. |
| `scrape` | Pull session transcripts into `~/.skillset/sessions/`. |
| `mine` | Extract nuggets from scraped sessions (`--llm` to add LLM extraction). |
| `synthesize` | Turn top clusters into draft SKILL.md files. |
| `drafts` | List pending drafts. `--rm <name>` discards. |
| `promote <name>` | Move a draft into canonical and sync. |
| `make` | One-shot skill authoring via LLM, with tier labeling. |
| `deep-dive` | One-off pass over your full session history. Resumable. |
| `cycle` | The nightly pipeline as a single command (scrape, mine, synthesize, cleanup, sync). |
| `schedule` | Register or remove the Windows Task Scheduler job. |
| `cleanup` | Dedup, conflict resolution, stale pruning. |
| `doctor` | Health check: store, LLM connectivity, mirror state, session data. |

## Architecture

```
~/.skillset/
  skills/             canonical SKILL.md directories (source of truth)
  config.json         { links: [{ agent, path }] }
  state.json          per-skill hashes, tiers, origin, conflictHistory
  sessions/           SQLite store of scraped transcripts
  drafts/             synthesized but unpromoted SKILL.md files
  .git                version history of the canonical store
```

The canonical store is the source of truth. Mirrors are derived. Before every write, skillset compares the mirror's current hash to its recorded hash. If they differ, you edited the mirror by hand and skillset promotes your edit back to canonical before rewriting the other mirrors.

See [CLAUDE.md](./CLAUDE.md) for the module-level breakdown.

## Principles

- **Your personalization is yours.** The canonical store is a git repo on your disk. Any agent that wants access is a mirror.
- **User edits are sacred.** Anything you change by hand gets promoted to canonical. The system never silently overwrites your edits.
- **One-way sync by default.** Canonical to mirror. No three-way merge.
- **No magic by default.** Sync, scrape, mine, promote, schedule. All explicit. The nightly cycle runs only because you installed its task.
- **Start boring.** Canonical is a git repo. Mirrors are files. The nightly cycle is a scheduled task. Nothing exotic.

## Not yet built

- Cross-platform (macOS, Linux)
- Writable Cursor and Codex mirror adapters
- Usefulness feedback loop: no signal yet on whether promoted skills actually reduced friction
- Project-level (non-global) mirror delivery
- Three-way merge or interactive conflict resolution

## License

[MIT](./LICENSE).

`src/ingest/` is forked from [nia-cli](https://github.com/trynia/nia-cli) (MIT). Notable delta: `.jsonl` is in the TEXT_EXTENSIONS allowlist, since upstream skips it and would silently drop Claude Code conversations.
