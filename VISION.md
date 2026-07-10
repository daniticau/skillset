# Vision: skillset

## What Is This?

A macOS coding-agent harness that gets better at working with *you* the more you use it. On the day you install it, skillset gathers the agent skills you already have in Claude and Codex, consolidates them into a store you own, and mirrors them back into those desktop app skill roots. When you ask it to tailor or dream nightly, it reads your past sessions, finds the friction you keep reliving, and writes small skills that make those agents better at you.

## The Problem

Every conversation with a coding agent is training data about you: your stack, your taste, your pet peeves, your repeated corrections, and the workflows you keep having to explain. Almost none of it gets captured in a portable way. You correct the same thing on Monday that you corrected on Friday. You switch between Claude and Codex and start from zero.

The agent learns only inside one harness, if it learns at all. Your personalization should not be trapped there.

## How It Works

`sks init` creates a canonical skill store on disk, detects the coding agents you have installed, asks which ones to connect, imports existing skills from those stores, resolves same-name conflicts by newest edit time, and mirrors the consolidated result back out.

After that, the loop is explicit and simple:

```sh
sks tailor
```

`tailor` scrapes past sessions, mines corrections and preferences, clusters recurring signals, asks an LLM whether each signal should edit an existing skill or create a new one, writes the result directly to canonical, and mirrors it automatically. There is no draft/promote ceremony. `--dry-run` is the preview escape hatch.

When transcript contents must stay on the machine, `sks tailor --local` performs local scraping, heuristic extraction, and candidate ranking without LLM synthesis. Claude Code or Codex can then inspect the ranked signals and apply only durable changes through `sks add` or `sks edit --stdin/--source`.

```sh
sks dream
```

`dream` installs a macOS LaunchAgent that runs the same improvement loop nightly. Each run scrapes and mines new or changed sessions, balances agent-mistake and user-preference signals, tunes existing auto-created skills, mirrors changes, commits the canonical store, and records the reviewed or skipped day in `state.json`.

The skills themselves live in a canonical store that you own. Claude and Codex are mirrors of that store. Edit a skill in either mirror and the change flows back to canonical before the next write, then out to the other app.

## The User Loop

**First run.** `sks init` sets up the store, connects detected agents, imports existing skills, and mirrors the consolidated store back out.

**When you want it to learn.** Run `sks tailor`. It turns past session friction into skills and installs them directly.

**When you want it to keep learning.** Run `sks dream`. It sets up nightly macOS tailoring and tracks which days have already been reviewed.

**When you notice a rule in the moment.** Run `sks tailor "prefer pnpm over npm"` or pipe a fuller instruction into `sks tailor --stdin`.

**When something looks off.** Run `sks doctor --repair`. It reconciles canonical and connected mirrors, promotes mirror-side edits, archives conflicts, and mirrors the repaired store.

**When an agent manages the library.** It uses `sks show`, `sks check`, `sks add`, or `sks edit --stdin` so changes go through canonical validation and automatic mirroring without opening an interactive editor or touching a mirror directly.

## Who It's For

Right now: people who work with coding agents enough that the friction compounds. People who notice they keep repeating themselves. People who switch between agent tools and resent starting over each time.

Later: deeper Claude and Codex workflows whose agent history contains enough signal to become a useful personal operating manual.

## What Success Looks Like

The agents I work with in six months know things about how I work that I never had to encode by hand each time, because skillset noticed repeated friction and wrote it down. Moving between Claude and Codex is nearly zero-friction because my personalization is not trapped in one vendor's harness. I own it. It follows me.

## Principles

**Your personalization is yours.** It should live on your disk, in a git-backed store you control. Any agent that wants access is a mirror, not an owner.

**The public surface is agent-operable.** The CLI provides non-interactive inspection, validation, capture, addition, and editing while keeping canonical ownership and automatic mirroring intact.

**User edits are sacred.** If you edit a skill directly in a mirror, that edit gets promoted back to canonical. The system never silently overwrites something you changed by hand.

**Mirrors are automatic.** Commands that mutate canonical skills or connected mirrors reconcile and mirror as part of the command.

**No draft ceremony.** Generated skills install directly with tier metadata. The user can preview with `--dry-run`, edit with `sks edit`, or remove with `sks remove`.

**Start boring.** Canonical skills are files. The store is a git repo. Conflicts are archived on disk. Nothing exotic, nothing you cannot inspect.
