# skillset

One skill library. Every coding agent.

Skillset keeps your agent skills in one folder you own and mirrors them into every coding agent on your machine. Add a skill from a tweet, a GitHub repo, a skills.sh page, a local folder, or stdin. It lands in the store, passes `sks check`, and shows up in Claude Code, Codex, Kimi Code, Grok, and Cursor at once. A rule that must hold in every session can be made always-on: skillset writes it into each agent's global instructions file too.

```sh
npm i -g skillset-cli
sks init
```

`init` creates `~/.skillset`, finds the coding agents you have, asks which to connect, imports the skills they already hold, and mirrors the merged library back out.

## Add a skill from anywhere

```sh
sks add https://x.com/juampitech/status/2090491139103064305     # a tweet that links to a skill
sks add https://skills.sh/cursor/plugins/unslop                   # a skills.sh page
sks add cursor/plugins --skill unslop                             # GitHub shorthand
sks add https://github.com/obra/superpowers/tree/main/skills/verification-before-completion
sks add ./my-skill                                                # a local folder
sks add --stdin < SKILL.md
```

A repo that holds several skills asks you to pick one with `--skill <name>`. A tweet that links to no skill fails with its text; add `--build` to turn that text into a skill with the builder.

## Always-on rules

A skill loads on demand. The agent sees its one-line description and pulls the body in when it decides the skill applies. That decision can miss.

Some rules must never miss. "Never use eyebrow text." "Use active voice." Those belong in the file the agent reads at the start of every session, not behind a trigger. Mark a skill always-on and skillset writes its body into a managed block of each agent's global instructions file:

```sh
sks always no-eyebrows
```

| Agent | Skills | Always-on block |
| --- | --- | --- |
| Claude Code | `~/.claude/skills` | `~/.claude/CLAUDE.md` |
| Codex | `~/.codex/skills` | `~/.codex/AGENTS.md` |
| Kimi Code | `~/.kimi-code/skills` | `~/.kimi-code/AGENTS.md` |
| Grok CLI | `~/.grok/skills` | `~/.grok/AGENTS.md` |
| Cursor | `~/.cursor/skills` | none (User Rules live in its settings UI) |
| Generic | `~/.agents/skills` | `~/.agents/AGENTS.md` |

The block sits between `<!-- skillset:always:start -->` and `<!-- skillset:always:end -->`. Everything outside it is yours and is never touched. Everything inside is rewritten from the store on every sync. Always-on text costs tokens on every turn, so `sks check` warns when an always-on body passes 150 words. `sks always <skill> --off` returns a skill to on-demand loading and removes it from the block.

The skill itself still mirrors as a normal skill, so an agent can also load it by name.

## Commands

| Command | What it does |
| --- | --- |
| `sks init` | Create the store, connect detected agents, import their skills, mirror back out. |
| `sks add [source]` | Add a skill from a path, a GitHub repo or URL, a skills.sh page, a tweet, or `--stdin`. `--skill` picks one from a repo. `--always` makes it always-on. |
| `sks always <skill>` | Make a skill always-on. `--off` returns it to on-demand. |
| `sks build [idea...]` | Split an idea into the smallest reusable skills, validate each, install what passes. `--json` previews. |
| `sks list` / `sks catalog` | List skills, flat or grouped by kind (Tool, Workflow, Judgement, Rule). |
| `sks show <skill>` | Print one canonical `SKILL.md`. `--json` or `--path` for agents. |
| `sks check [skill]` | Validate structure, trigger wording, context size, and always-on length. |
| `sks edit <skill>` | Edit in `$EDITOR`, or replace from `--stdin` / `--source`. |
| `sks remove <skill>` | Delete a skill and prune it from every mirror. `--block` also stops it being adopted back. |
| `sks status` | Connected mirrors, their instructions files, and every skill's state. |
| `sks connect <agent>` / `sks disconnect <agent>` | Manage mirrors. Connecting imports the agent's existing skills first. |
| `sks doctor` | Store health, LLM reachability, mirror drift, always-on block state, conflicts. |
| `sks doctor --repair` | Relink a moved store, then reconcile every mirror. `--store <path>` sets the link by hand. |

Every command that changes the store mirrors afterwards. There is no `sync` command to forget.

## How mirroring works

```txt
~/.skillset/
  skills/         canonical SKILL.md directories (often a symlink into a repo you keep)
  config.json     { links: [{ agent, path }], ignore: [skillName] }
  state.json      hashes, origins, user edits, conflict history
  conflicts/      archived losing versions from mirror conflicts
  history.jsonl   what changed, when, from where
```

The store is the source of truth. Mirrors are derived from it. Before writing a mirror, skillset compares the mirror's hash with the one it recorded last time. If you edited the mirror copy by hand, that edit is promoted to canonical first. If two mirrors diverge, the newest edit wins and the loser is archived under `conflicts/`.

Skillset deletes a mirror copy only when it holds a hash proving it wrote that copy. A skill you installed into an agent yourself is adopted into the store or ignored, never removed. If the store folder goes missing (a symlink into a repo that moved, say), sync refuses to run rather than prune every mirror; `sks doctor --repair` finds the folder and relinks it.

## Codex plugin

`plugins/skillset` is a thin Codex plugin. It tells Codex when to reach for `sks` to inspect, add, or edit skills. It adds no store and no MCP server.

```sh
codex plugin marketplace add daniticau/skillset
```

## Principles

- **You own it.** Plain Markdown in a folder on your disk. Put it in git. Agents are mirrors, not owners.
- **Agents can operate it.** Every command has a non-interactive path. An agent can add, edit, check, and show skills without a human editor.
- **Manual edits survive.** Mirror-side edits are promoted, never overwritten.
- **On-demand or always-on, your call.** Most knowledge should load only when it matters. A few rules must hold every time. Both live in the same store.
- **Nothing exotic.** Files, hashes, a symlink, a managed block between two comments. Everything is inspectable.

## Dev

```sh
pnpm install
pnpm build        # tsup → dist/cli.js
pnpm test
pnpm typecheck
pnpm cli:link     # write ~/.local/bin/sks pointing at this checkout; rerun if the repo moves
pnpm app:build    # native macOS companion
```

## License

[MIT](./LICENSE).
