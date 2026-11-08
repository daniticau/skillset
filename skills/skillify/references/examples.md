# Capture examples

Raw input on the left, the skill it should become on the right.

## A preference worth capturing

**User says:** "skillify — always use pnpm in my projects, never npm or yarn"

**Becomes** one Tool skill, loaded on demand:

```yaml
name: pnpm-package-manager
description: Uses pnpm for all JavaScript and TypeScript package operations. Apply when installing, adding, removing, or running scripts in any Node project.
```

Body states the rule and the workspace-filter form. Short, one fact. It stays on demand because a clear moment triggers it: any package command.

## A task prompt with a name

**User says:** `/skillify "find all of the implicit state machines in my app" as state-machines`

**Becomes** one Workflow skill, run as `/state-machines`:

```yaml
name: state-machines
description: Finds implicit state machines in the current app, where state hides in flags, status strings, and scattered transitions. Use only when the user runs /state-machines or asks to find implicit or hidden state machines.
```

Body, in three parts:

- **What counts.** Two or more booleans that must never be true together. A status string or enum set from several places. Transitions guarded by ad hoc `if` checks instead of one owner.
- **Steps.** If the user names a folder, search only there. Search for those shapes, then trace each one's writes to list its states and transitions.
- **Output.** One entry per machine: its states, its transitions with `file:line`, and the impossible states the code allows.

The name comes from the user as written. The one-line prompt grows into a definition and an output shape, so every run looks for the same things and reports them the same way. "Use only when" holds it back, because a whole-app scan should not start on its own. Skillify does not run the search.

## A source to distill

**User says:** `/skillify ./docs/release.md as release` — a 300-line runbook.

**Read it and keep** only what an agent cannot derive:

- The private `./scripts/bump --channel beta` flag and the order: bump, tag, then upload.
- The trap: notarization drops if the laptop sleeps, and `xcrun notarytool info <id>` recovers it.

**Drop** what any agent knows: what a git tag is, how to install Xcode, generic semver advice.

**Becomes** one Workflow skill named `release`, about 40 lines. The full runbook stays where it is; the skill can point to it by path.

## A compound instruction that should split

**User says:** "when I say ship it, run the full test suite and typecheck first, then never push straight to master"

**Becomes two** linked skills, because the trigger phrase and the branch constraint fire in different situations:

- `ship-it-gate` (Workflow): what "ship it" means: tests, then typecheck, then commit
- `never-push-master` (Rule): applies to any push, not just "ship it"

Cross-linked with `[[never-push-master]]`. Splitting matters: the branch rule must fire even when the user never says "ship it".

## Something that should be refused

**User says:** "skillify — remember that React useEffect runs after render"

This is general knowledge the model already has. Do not write it. Say so and explain that a skill should hold what the agent cannot derive.

## A vague reference resolved from context

**User says:** "skill that" — after correcting the agent for claiming a fix worked without running the tests.

**Resolve to:** "Never claim work is complete without running the verifying command and reading its output."

The situational detail (which test, which file) is dropped. The durable rule survives.

**Load mode: always-on.** No single request signals when it applies, since any task can end in a claim of done. The body fits in a few lines, so it costs little in every session.
