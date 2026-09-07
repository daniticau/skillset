# Vision: skillset

## The problem

You teach a coding agent how you work. Then you open a different agent and teach it again. Every agent keeps its own skills folder and its own instructions file. Nothing you learn in one carries to the next.

Skills are the fix the industry settled on: a `SKILL.md` with a name, a one-line description, and a body. Claude Code, Codex, Kimi Code, Grok, and Cursor all read the same format. What they do not share is the folder.

## What skillset is

Two things. Nothing else.

**A canonical store.** One folder you own that holds every skill. Every connected agent is a mirror of it. Add a skill once and it is everywhere. Edit a mirror by hand and the edit flows back.

**A skill builder.** Fast ways to get knowledge into that store: paste a link, pipe a file, or give the builder an idea and let it split the idea into small skills that each pass `sks check`.

## Two ways a skill can load

A skill normally loads on demand. The agent reads the description at session start and pulls the body in when it decides the skill applies. This is cheap. It is also a judgment call, and judgment calls miss.

Some rules must not miss. They belong in the file the agent reads unconditionally, every session, before your first message. Each agent has one: `CLAUDE.md`, `AGENTS.md`. Skillset owns a block in each of those files and fills it with the skills you mark always-on.

So a skill has two modes, and you pick per skill. Long, procedural, situational knowledge stays on demand. Short, absolute constraints go always-on. Both live in the same store, both mirror everywhere, and one command flips between them.

## What a skill must earn

A skill earns its place only if it holds something an agent cannot work out on its own: a private tool, a personal preference, a workflow you paid for, a way of judging you invented. Knowledge the model already has is not a skill. Repeating the description in the body is not a skill.

## What success looks like

You see a skill in a tweet and it is in every agent you use thirty seconds later. You write a rule once and never see it broken again in any agent. You move between tools and nothing is lost, because the store was never inside any of them.

## Principles

**You own it.** Files on your disk, in a folder you can put in git.

**Agents are normal operators.** Every command works without a human at the keyboard.

**Manual edits survive.** Mirror-side changes are promoted, never overwritten.

**Mirrors are automatic.** Any command that changes the store writes the mirrors before it returns.

**Nothing exotic.** Plain files, content hashes, a symlink, a managed block between two comments.
