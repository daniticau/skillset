---
name: skillify
description: "Captures a preference, workflow, correction, or anti-pattern as a reusable Skillset skill. Use only when the user explicitly asks for a skill: \"skillify\", \"skill this\", \"make this a skill\", or \"save this as a skill\". A plain \"remember this\" goes to memory, not to a skill."
license: "MIT"
---

# Skillify

Turn an instruction into a durable skill in the user's canonical Skillset library.

## Trigger

Fire on: "skillify", "skill this", "skill that", "make this a skill", "make a skill that…", "turn this into a skill", "save this as a skill", "remember this for next time", "capture this preference", "codify this", "add this to my preferences".

Do not fire when "skill" refers to a product feature, game mechanic, or domain object rather than agent behavior.

## Does it earn a skill?

A skill is worth writing only when it encodes something an agent **cannot derive on its own**:

| Worth capturing | Not worth capturing |
|---|---|
| A private tool the model has never seen | General knowledge the model already has |
| The user's personal preference or taste | Framework docs available online |
| A hard-won workflow with non-obvious ordering | A one-off detail about today's task |
| A judgement algorithm the user invented | Anything a competent agent rediscovers |

If it fails this test, say so instead of writing it. A library of things the model already knew is pure context tax.

## Workflow

**Step 1 — Resolve the instruction.**
If the user gave the rule after the trigger phrase, use it directly. If they said "this" or "that", state the correction, preference, or lesson from the conversation in one durable sentence. Strip the situational wording; keep the intent. Ask one clarifying question only when the referent is genuinely unknowable.

**Step 2 — Check for overlap.**
Run `sks list`. If an existing skill already covers the rule, update it with `sks edit <name> --stdin` instead of adding a near-duplicate.

**Step 3 — Write and install.**
Write the SKILL.md by following [references/authoring.md](references/authoring.md). The description is the only thing an agent sees when deciding whether to load a skill, so it decides whether the skill ever fires. See [references/examples.md](references/examples.md) for raw-instruction → captured-skill transformations.

```sh
sks add --stdin < SKILL.md
sks check <name>
```

`sks add` mirrors to every connected agent automatically.

**Step 4 — Report.**
Name the skill, and say whether it was new or an update. If an existing skill already covered the rule, say that. It is a good outcome, not a failure.

## Guardrails

- Never write directly into an agent's skills directory. Canonical is the source of truth; mirrors are derived.
- Never capture a one-off task detail as a durable preference.
- Do not overfit to the current project when the preference is broader — or generalize a genuinely project-specific rule.
- Prefer updating an overlapping skill over creating a near-duplicate.
