# Vision: skillset

## What is this?

A coding-agent harness that gets better at working with *you* the more you use it. When your agent gets something wrong — slightly off, or completely sideways — a background process investigates what went wrong and writes a skill that would have prevented it. Over time, the friction fades.

## The Problem

Every conversation you have with a coding agent is training data about you — your stack, your taste, your pet peeves, the recurring mistakes your agent keeps making. Almost none of it gets captured. You correct the same things on Monday that you corrected on Friday. You switch from Claude Code to Cursor for an afternoon and start from zero.

The harness you work inside every day doesn't learn. That's the gap.

## How It Works

You work with your agent normally. In the background, another process reads through your session history looking for the moments where things went wrong — a rejected plan, a correction, a redo, a visible sigh. It traces the failure back to its cause and drafts a small skill: a rule, a pattern, a preference, a piece of context the agent should have had.

Some skills get installed silently because they're obviously safe. Others get surfaced for you to approve, edit, or throw away. You decide the threshold.

The skills themselves live in a canonical store that you own. Every agent harness you use — Claude Code today, whatever else tomorrow — is a mirror of that store. Edit a skill in any mirror and the change flows back to canonical, then out to all the others.

## Who It's For

Right now: me, and people who work with coding agents enough that the friction starts to compound. People who've noticed they keep repeating themselves. People who switch between agent tools and resent starting over each time.

Later, maybe: anyone who interacts with agents often enough that their chat history is a meaningful signal about who they are.

## What Success Looks Like

The agent I work with in six months knows things about how I work that I never explicitly told it — because it watched, noticed, and wrote them down on its own. The friction of onboarding a new agent tool is near zero, because my personalization isn't trapped in any one vendor's harness. I own it. It follows me.

## Principles

**Your personalization is yours.** It shouldn't live in one vendor's database. It shouldn't vanish when you switch tools. The canonical store is on your disk, in a git repo you control. Any agent that wants access is a mirror, not an owner.

**User edits are sacred.** If you edit a skill directly in a mirror, that edit gets promoted back to canonical. The system never silently overwrites something you changed by hand.

**No magic by default.** Mining runs when you ask it to. Sync runs when you ask it to. Skills that get auto-installed are ones you've told the system are safe to auto-install. Everything else waits for you.

**Start boring.** The current codebase is a sync engine and nothing else — no mining, no scoring, no proactivity. The interesting layer sits on top and gets built once the skeleton is solid. Get the plumbing right first.
