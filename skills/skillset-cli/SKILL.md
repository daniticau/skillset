---
name: skillset-cli
description: "Inspect, check, add, edit, rename, or remove skills in the user's Skillset library with the sks CLI. Use when the user asks to change their skills, says \"sks\" or \"Skillset\", or when another skill such as skillify needs to write to the library."
license: "MIT"
---

# Manage Skills with Skillset

Use the `sks` CLI so canonical skills stay synchronized across every connected agent.

## Inspect

Run the smallest command that answers the question:

```sh
sks list
sks show <skill>
sks show <skill> --json
sks check [skill]
sks doctor
```

Use `sks catalog` to see skills grouped by kind: Tool, Workflow, Judgement, Rule.

## Capture or Improve

- For a complete skill written by an agent, pipe it to `sks add --stdin`, or pass a folder with `sks add <path>`.
- For a new skill, write a complete SKILL.md and pipe it to `sks add --stdin`, then run `sks check <name>`.
- To change only the name, description, or body, pipe `{ "name", "rename"?, "description"?, "body"? }` to `sks desktop save`. It keeps the other frontmatter.
- For a full replacement, use `sks edit <skill> --stdin`, or `sks edit <skill> --source <path>` when supporting files change too.
- Use `sks always <skill>` for a short rule that must load in every session. `--off` returns it to on-demand.
- Run `sks check` after every addition or edit.

Mutating commands reconcile and mirror automatically. Report whether Skillset added, edited, skipped, adopted, repaired, or mirrored skills.

## Guardrails

- Treat `~/.skillset/skills/` as canonical; never write directly to an agent's skills folder such as `~/.claude/skills` or `~/.codex/skills`.
- Preserve supporting `scripts/`, `references/`, and `assets/` when a skill uses them.
- Do not remove a skill unless the user explicitly asked to remove it.
- Use `sks doctor --repair` only when repair or reconciliation is intended.
