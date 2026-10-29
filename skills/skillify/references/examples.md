# Capture examples

Raw instruction on the left, the skill it should become on the right.

## A preference worth capturing

**User says:** "skillify — always use pnpm in my projects, never npm or yarn"

**Becomes** one `tool` skill:

```yaml
name: pnpm-package-manager
description: Uses pnpm for all JavaScript and TypeScript package operations. Apply when installing, adding, removing, or running scripts in any Node project.
```

Body states the rule and the workspace-filter form. Short, one fact.

## A compound instruction that should split

**User says:** "when I say ship it, run the full test suite and typecheck first, then never push straight to master"

**Becomes two** linked skills, because the trigger phrase and the branch constraint fire in different situations:

- `ship-it-gate` (workflow) — what "ship it" means: tests, then typecheck, then commit
- `never-push-master` (rule) — applies to any push, not just "ship it"

Cross-linked with `[[never-push-master]]`. Splitting matters: the branch rule must fire even when the user never says "ship it".

## Something that should be refused

**User says:** "skillify — remember that React useEffect runs after render"

This is general knowledge the model already has. Do not write it. Say so and explain that a skill should hold what the agent cannot derive.

## A vague reference resolved from context

**User says:** "skill that" — after correcting the agent for claiming a fix worked without running the tests.

**Resolve to:** "Never claim work is complete without running the verifying command and reading its output."

Note what happened: the situational detail (which test, which file) is dropped. The durable rule survives.
