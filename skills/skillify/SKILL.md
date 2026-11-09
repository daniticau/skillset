---
name: skillify
description: "Turns a preference, correction, workflow, task prompt, or source into a reusable Skillset skill. Use only when the user explicitly asks for a skill: \"skillify\", \"skill this\", \"make this a skill\", or \"save this as a skill\". A plain \"remember this\" goes to memory, not to a skill."
category: "Special"
kind: workflow
license: "MIT"
---

# Skillify

Turn what the user gives you into one small skill in their Skillset library.

## When to fire

Fire on explicit skill words: "skillify", "/skillify", "skill this", "skill that", "make this a skill", "make a skill that…", "turn this into a skill", "save this as a skill".

Do not fire on "remember this" or "note that" alone. Those go to the agent's memory. Do not fire when "skill" means a product feature, a game mechanic, or another domain object.

## Input

```text
/skillify "find all of the implicit state machines in my app" as state-machines
/skillify https://example.com/deploy-runbook as deploy
/skillify ./notes/release-steps.md
/skillify that
```

- The input is a rule, a task prompt, or a source. A source is a URL, a file path, or pasted text.
- `as <name>` sets the skill name. The name is also how the user calls the skill, for example `/state-machines` in Claude Code.
- "this", "that", or no input means the latest correction, preference, or workflow in the conversation.

## Does it earn a skill?

A skill is worth writing only when it encodes something an agent **cannot derive on its own**:

| Worth capturing | Not worth capturing |
|---|---|
| A private tool the model has never seen | General knowledge the model already has |
| The user's personal preference or taste | Framework docs available online |
| A hard-won workflow with non-obvious ordering | A one-off detail about today's task |
| A judgement algorithm the user invented | Anything a competent agent rediscovers |
| A task prompt the user named to run again | |

If it fails, say why in one sentence and write nothing. Every skill costs context in every session.

A named task prompt passes, because the task, its scope, and its name are the user's choices. The test then applies to each line of the body. Keep the user's definition, scope, and output shape. Cut steps any agent would take anyway.

## Workflow

### 1. Resolve the input

- **Rule or correction.** State it in one durable sentence. Drop the situational detail, such as this file or this bug. Keep the user's own words where they carry taste.
- **Task prompt.** Make a Workflow skill the user runs on demand. Keep the user's words for the goal. Add what counts as a hit, the steps, and the output shape, because an agent would guess those differently on each run.
- **Source.** Fetch the URL, read the file, or take the pasted text. Keep only what an agent cannot derive: private tools and flags, the user's choices, non-obvious order, and known traps. If the source is already a SKILL.md or a skills repo, install it unchanged with `sks add <source>`, or `sks add --stdin` for pasted text. Then set its category and kind with `sks category` and `sks kind`, and go to the check in step 7.

Ask one question only when the intent is unknowable. Otherwise decide, and report the choice.

### 2. Split, merge, and name

Write one skill per situation that should load it. Split an input whose parts fire at different times. Run `sks list` and read the descriptions. If an existing skill covers the same situation, update it with `sks edit <name> --stdin` instead of adding a near-duplicate.

Use the name from `as <name>`. Convert it to kebab-case if needed, and say so. Otherwise pick a specific noun phrase or gerund, such as `state-machines` or `processing-pdfs`. If a different skill already has the name, ask before you replace it. If `sks add` says an agent's folder already holds the name, the user put a skill there. Ask whether to adopt it (`sks doctor --repair`) or rename.

### 3. Sort it

Give every skill a `category` and a `kind` in its frontmatter. Run `sks list` and reuse an existing category when one fits. Make a new one, one or two words in Title Case, only when none fits. Pick the kind from tool, workflow, judgement, or rule. See "Category and kind" in [references/authoring.md](references/authoring.md).

### 4. Choose the load mode

On demand is the default. Make it always-on (`always: true`) only when all three hold:

1. It is a rule that must hold in every session.
2. No single request signals when it applies, so on-demand loading would miss it.
3. The body fits in 150 words. Skillset copies it into every agent's global instructions file.

### 5. Write it

Follow [references/authoring.md](references/authoring.md). The description decides whether the skill ever loads, so spend the most care there. See [references/examples.md](references/examples.md) for input-to-skill pairs.

### 6. Test it cold

Read only the name and description, as an agent with no context would:

- Would it load for the user's own phrasing of the request?
- Would it stay quiet for nearby requests that are not this one?

Then read the body as a fresh agent. Could it act without this conversation? Fix every "no" before you install.

### 7. Install and check

Pipe a single-file skill through a quoted heredoc, so the shell leaves `$` alone:

```sh
sks add --stdin <<'EOF'
---
name: <name>
description: "<What it does>. Use when the user <request>."
category: "<Category>"
kind: <kind>
---
<body>
EOF
sks check <name>
```

For a skill with `references/` or `scripts/`, write the folder in a temp directory and run `sks add <folder>`. Add `--always` for an always-on skill.

`sks add` does not validate, so always run `sks check` right after it. Fix every error and every warning you can with `sks edit <name> --stdin`.

### 8. Report

Give three lines: the name and whether it is new or an update; how to call it, such as `/state-machines`; and the category, kind, and load mode plus any choice you made. If an existing skill already covered the input, say so. That is a good outcome.

## Guardrails

- Write only through `sks`, never into an agent's skills folder.
- Do not run a task prompt. Skillify saves it; the user runs it later by name.
- Never put a secret in a skill, such as a token, key, or password. Every connected agent gets a copy.
- Never save a one-off task detail as a durable rule.
- Match the scope to the rule. Do not tie a broad preference to this project, or widen a project-only rule.
