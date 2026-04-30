# Vision: skillset

## What Is This?

A coding-agent harness that gets better at working with *you* the more you use it. On the day you install it, skillset gathers the agent skills you already have, consolidates them into a store you own, and mirrors them back into the tools you use. When you ask it to tailor, it reads your past sessions, finds the friction you keep reliving, and writes small skills that make future agents better at you.

## The Problem

Every conversation with a coding agent is training data about you: your stack, your taste, your pet peeves, your repeated corrections, and the workflows you keep having to explain. Almost none of it gets captured in a portable way. You correct the same thing on Monday that you corrected on Friday. You switch from Claude Code to Codex or another agent and start from zero.

The agent learns only inside one harness, if it learns at all. Your personalization should not be trapped there.

## How It Works

`sks init` creates a canonical skill store on disk, detects the coding agents you have installed, asks which ones to connect, imports existing skills from those stores, resolves same-name conflicts by newest edit time, and mirrors the consolidated result back out.

After that, the loop is explicit and simple:

```sh
sks tailor
```

`tailor` scrapes past sessions, mines corrections and preferences, clusters recurring signals, asks an LLM whether each signal should edit an existing skill or create a new one, writes the result directly to canonical, and mirrors it automatically. There is no draft/promote ceremony. `--dry-run` is the preview escape hatch.

The skills themselves live in a canonical store that you own. Every agent harness you use is a mirror of that store. Edit a skill in any mirror and the change flows back to canonical before the next write, then out to all the others.

## The User Loop

**First run.** `npx skillset-cli init` sets up the store, connects detected agents, imports existing skills, and mirrors the consolidated store back out.

**When you want it to learn.** Run `sks tailor`. It turns past session friction into skills and installs them directly.

**When you notice a rule in the moment.** Run `sks tailor "prefer pnpm over npm"` or pipe a fuller instruction into `sks tailor --stdin`.

**When something looks off.** Run `sks doctor --repair`. It reconciles canonical and connected mirrors, promotes mirror-side edits, archives conflicts, and mirrors the repaired store.

## Who It's For

Right now: people who work with coding agents enough that the friction compounds. People who notice they keep repeating themselves. People who switch between agent tools and resent starting over each time.

Later: anyone whose agent history contains enough signal to become a useful personal operating manual.

## What Success Looks Like

The agent I work with in six months knows things about how I work that I never had to encode by hand each time, because skillset noticed repeated friction and wrote it down. Onboarding a new agent tool is nearly zero-friction because my personalization is not trapped in one vendor's harness. I own it. It follows me.

## Principles

**Your personalization is yours.** It should live on your disk, in a git-backed store you control. Any agent that wants access is a mirror, not an owner.

**The public surface is small.** `init`, `tailor`, `list`, `status`, `connect`, `disconnect`, `edit`, `remove`, `doctor`.

**User edits are sacred.** If you edit a skill directly in a mirror, that edit gets promoted back to canonical. The system never silently overwrites something you changed by hand.

**Mirrors are automatic.** Commands that mutate canonical skills or connected mirrors reconcile and mirror as part of the command.

**No draft ceremony.** Generated skills install directly with tier metadata. The user can preview with `--dry-run`, edit with `sks edit`, or remove with `sks remove`.

**Start boring.** Canonical skills are files. The store is a git repo. Conflicts are archived on disk. Nothing exotic, nothing you cannot inspect.
