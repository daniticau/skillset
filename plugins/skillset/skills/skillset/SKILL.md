---
name: skillset
description: Use Skillset when the user asks to capture, tailor, catalog, inspect, repair, or remember reusable coding-agent preferences and skills.
---

# Skillset

Skillset is the user's portable personalization layer for coding agents. It owns one canonical skill store at `~/.skillset/skills/` and mirrors every skill into every connected harness, including Claude (`~/.claude/skills`), Codex (`~/.codex/skills`), Kimi Code (`~/.kimi-code/skills`), and Grok CLI (`~/.grok/skills`).

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

If transcript contents must stay local, use `sks tailor --local`. It scrapes, mines, and ranks candidates without LLM synthesis; review the candidates and apply exact changes with `sks add` or `sks edit --stdin`.

For inspection and diagnosis, prefer the smallest useful command:

```sh
sks list
sks catalog
sks show <skill>
sks check [skill]
sks status
sks doctor
```

For exact agent-authored skill management, inspect before changing anything:

```sh
sks show <skill> --json
sks add ./path/to/skill --managed
sks add --stdin --managed < ./SKILL.md
sks edit <skill> --stdin --managed < ./SKILL.md
sks edit <skill> --source ./path/to/revised-skill --managed
sks check <skill>
```

`add` and `edit --source` accept complete skill directories so scripts, references, and assets remain attached. `--managed` marks agent-created work as eligible for later tuning; omit it for a deliberately user-owned/manual skill. Every mutation validates and mirrors the result.

Use `sks doctor --repair` only when the user asks to repair or reconcile mirror state.

## Guardrails

- Do not hand-edit individual harness mirrors when the user's intent is to preserve a reusable Skillset preference.
- Do not bypass `~/.skillset/skills/`; it is the source of truth.
- Inspect an existing skill before editing it, and use `sks check` after direct additions or edits.
- Do not remove a skill unless the user explicitly asked to remove it.
- Do not create per-model variants of a Skillset skill. A connected harness receives the shared canonical version.
- Do not capture one-off task details unless the user clearly wants them preserved for future sessions.
- After a mutating Skillset command finishes, tell the user whether Skillset created, updated, skipped, mirrored, or repaired anything.
