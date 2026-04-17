# Vision: skillset

## What is this?

A coding-agent harness that gets better at working with *you* the more you use it. On the day you install it, it reads your entire coding history — Claude Code, Codex, Cursor — and writes the foundational skills that would have saved you the friction you've already lived through. Every night after that, it reviews the day's work, notices what went sideways, and drafts small improvements. Over time, the friction fades.

## The Problem

Every conversation you have with a coding agent is training data about you — your stack, your taste, your pet peeves, the recurring mistakes your agent keeps making. Almost none of it gets captured. You correct the same things on Monday that you corrected on Friday. You switch from Claude Code to Cursor for an afternoon and start from zero.

The harness you work inside every day doesn't learn. That's the gap.

## How It Works

You work with your agent normally. In the background — at 2am, when your machine is idle and your subscriptions aren't busy — another process reads the sessions from that day, looking for moments where things went wrong: a rejected plan, a correction, a redo, a visible sigh. It traces the failure back to its cause and drafts a small skill that would have prevented it.

At the end of each nightly pass, skillset also cleans up after itself: if two skills contradict each other, it picks the most recent (because your preferences evolve). If two skills say the same thing twice, it merges them. Stale auto-generated skills that haven't mattered in a while get marked for pruning.

Some skills get installed silently because they're obviously safe. Others get surfaced for you to approve, edit, or throw away. You decide the threshold.

The skills themselves live in a canonical store that you own. Every agent harness you use — Claude Code, Cursor, Codex today, whatever else tomorrow — is a mirror of that store. Edit a skill in any mirror and the change flows back to canonical, then out to all the others.

## The Daily Loop

**Day 0: deep dive.** `sks init` walks you through setup — which agents to link, whether to run the deep dive now, whether to register the nightly task. The deep dive reads every session on disk (could be months of history) and generates up to ten foundational skills that capture what you've already taught your agents the hard way. It's resumable: interrupt it and re-running picks up where it left off.

**Every day after.** A scheduled task fires at 2am. If your machine is idle (CPU quiet, no recent input), the cycle starts: scrape new sessions from that day, mine for signals, draft zero to three new skills, run a cleanup pass (dedup, conflict resolution, stale pruning), sync to all your mirrors, and commit the result to the canonical store's internal git log. Wake up the next morning and find your harness a little better at you than it was yesterday.

If you're still up at 2am, the cycle waits until the next night rather than stealing compute.

## Who It's For

Right now: me, and people who work with coding agents enough that the friction starts to compound. People who've noticed they keep repeating themselves. People who switch between agent tools and resent starting over each time.

Later, maybe: anyone who interacts with agents often enough that their chat history is a meaningful signal about who they are.

## What Success Looks Like

The agent I work with in six months knows things about how I work that I never explicitly told it — because it watched, noticed, and wrote them down on its own. The friction of onboarding a new agent tool is near zero, because my personalization isn't trapped in any one vendor's harness. I own it. It follows me.

## Principles

**Your personalization is yours.** It shouldn't live in one vendor's database. It shouldn't vanish when you switch tools. The canonical store is on your disk, in a git repo you control. Any agent that wants access is a mirror, not an owner.

**Boundaries are explicit.** Skills you author yourself are never touched by automation. Skills the system generated can evolve, but if you edit one, the edit is preserved unless a later pass finds real contradictory evidence. You always know which rules are yours and which are the system's — every skill carries its origin.

**User edits are sacred.** If you edit a skill directly in a mirror, that edit gets promoted back to canonical. The system never silently overwrites something you changed by hand.

**No magic by default.** The nightly cycle runs only because you installed its scheduled task. Skills get auto-installed only in tiers you've marked safe. Everything else waits for you.

**Start boring.** Every layer sits on a boring-and-correct one below it. The canonical store is a git repo. The mirrors are files. The nightly cycle is a scheduled task. Nothing exotic — nothing you can't inspect.
