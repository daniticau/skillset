---
name: skillset
description: Use Skillset when the user asks to capture, tailor, catalog, inspect, repair, or remember reusable coding-agent preferences and skills.
---

# Skillset

Skillset is the user's portable personalization layer for coding agents. It owns the canonical skill store at `~/.skillset/skills/` and mirrors that store into Claude (`~/.claude/skills`) and Codex Desktop (`~/.codex/skills`).

Use this skill when the user asks to:

- "skill this", "remember this", "capture this", or "make this reusable"
- turn a correction, preference, workflow, or recurring anti-pattern into a future instruction
- tailor skills from recent or past sessions
- list or catalog what Skillset knows
- inspect, diagnose, connect, repair, or reconcile skill mirrors

## Commands

For an explicit preference or rule, run:

```sh
sks tailor --stdin
```

Pass a concise, self-contained instruction on stdin. Include enough context that a future agent can apply the rule without seeing the original conversation. For a short one-line rule, `sks tailor "<instruction>"` is also fine.

For learning from session history, run:

```sh
sks tailor
```

For inspection and diagnosis, prefer the smallest useful command:

```sh
sks list
sks catalog
sks status
sks doctor
```

Use `sks doctor --repair` only when the user asks to repair or reconcile mirror state.

## Guardrails

- Do not hand-edit mirrored Codex skills when the user's intent is to preserve a reusable Skillset preference.
- Do not bypass `~/.skillset/skills/`; it is the source of truth.
- Do not route Skillset work through Cursor or other editor-specific skill stores; this project supports Claude and Codex Desktop.
- Do not capture one-off task details unless the user clearly wants them preserved for future sessions.
- After a mutating Skillset command finishes, tell the user whether Skillset created, updated, skipped, mirrored, or repaired anything.
