# skillset

I use a few different coding agents, and each one keeps its own skills folder. Skillset keeps all your skills in one folder and syncs them into every agent you use: Claude Code, Codex, Kimi Code, Grok, and Cursor.

```sh
npm i -g skillset-cli
sks init
```

`init` creates `~/.skillset`, finds the agents on your machine, pulls in the skills they already have, and syncs the merged set back out to all of them.

It's still early.

## Adding skills

You can add a skill from almost anywhere:

```sh
sks add ./my-skill                                    # a local folder
sks add cursor/plugins --skill unslop                 # a GitHub repo
sks add https://skills.sh/cursor/plugins/unslop       # a skills.sh page
sks add https://x.com/juampitech/status/2090491139103064305   # a tweet that links to a skill
sks add --stdin < SKILL.md
```

If a repo has more than one skill, pick one with `--skill <name>`. If a tweet doesn't link to a skill, add `--build` to turn its text into one.

## Always-on rules

Agents only load a skill when they think it applies, and sometimes they guess wrong. For rules that should apply every time, like "use active voice", you can make a skill always-on:

```sh
sks always no-eyebrows
```

Skillset then writes that skill into each agent's global instructions file (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`, and so on). It only touches the block between `<!-- skillset:always:start -->` and `<!-- skillset:always:end -->`, so the rest of the file stays yours. Cursor keeps its rules in its settings, so it doesn't get this block.

Always-on text costs tokens every turn, so `sks check` warns when one goes over 150 words. `sks always <skill> --off` turns it back into a normal skill.

## Commands

| Command | What it does |
| --- | --- |
| `sks init` | Set up the store and connect your agents |
| `sks add [source]` | Add a skill |
| `sks always <skill>` | Make a skill always-on (`--off` to undo) |
| `sks build [idea...]` | Turn an idea into one or more skills |
| `sks list` | List your skills (`sks catalog` groups them) |
| `sks show <skill>` | Print a skill |
| `sks check [skill]` | Check a skill's structure, wording, and size |
| `sks edit <skill>` | Edit a skill |
| `sks rename <skill> <new-name>` | Rename a skill everywhere |
| `sks remove <skill>` | Delete a skill everywhere (`--block` keeps it from coming back) |
| `sks status` | Show connected agents and each skill's state |
| `sks connect <agent>` / `sks disconnect <agent>` | Add or drop an agent |
| `sks doctor` | Check for problems (`--repair` to fix a moved store) |

Every command that changes something syncs right after, so there's no `sync` command.

## How syncing works

`~/.skillset/skills` is the real copy. Each agent's folder is a mirror of it.

If you edit a skill inside an agent's folder, skillset notices and copies that edit back to the store before the next sync. If two mirrors conflict, the newest edit wins and the other version goes to `~/.skillset/conflicts/`.

Skillset only deletes files it knows it wrote. A skill you put in an agent's folder yourself gets added to the store, never deleted. If the store goes missing (say it was a symlink into a repo you moved), sync stops instead of wiping your mirrors, and `sks doctor --repair` relinks it.

## Codex plugin

`plugins/skillset` is a small Codex plugin that tells Codex when to use `sks`.

```sh
codex plugin marketplace add daniticau/skillset
```

## Development

```sh
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm cli:link     # point ~/.local/bin/sks at this checkout
pnpm app:build    # the macOS app
```

## License

[MIT](./LICENSE)
