import { Command } from "commander";
import pc from "picocolors";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { loadEnv } from "./core/env.js";
import { initCommand } from "./commands/init.js";
import { connectCommand, disconnectCommand } from "./commands/link.js";
import { statusCommand } from "./commands/status.js";
import { listCommand } from "./commands/list.js";
import { catalogCommand } from "./commands/catalog.js";
import { doctorCommand } from "./commands/doctor.js";
import { addCommand, alwaysCommand, editCommand, removeCommand, renameCommand, showCommand } from "./commands/manage.js";
import { checkCommand } from "./commands/check.js";
import { buildCommand } from "./commands/build.js";
import { desktopSaveCommand, desktopSnapshotCommand } from "./commands/desktop.js";
import { supportedAgents } from "./core/adapters/index.js";

// Load ~/.skillset/.env before any command reads process.env.
loadEnv();

export function createProgram(): Command {
  const program = new Command();

  program
    .name("sks")
    .description("one canonical skill library, mirrored into every coding agent")
    .version("0.2.0");

  program
    .command("init")
    .description("set up the skill store, connect detected agents, and import existing skills")
    .option("--no-auto-link", "skip auto-connecting detected agents")
    .option("--non-interactive", "skip prompts; use defaults")
    .action(async (options: { autoLink?: boolean; nonInteractive?: boolean }) => {
      await initCommand({
        noAutoLink: options.autoLink === false,
        nonInteractive: options.nonInteractive,
      });
    });

  program
    .command("build [idea...]")
    .description("decompose an idea into the smallest reusable skills and install them")
    .option("--stdin", "read the idea from stdin")
    .option("--json", "print the proposal as JSON without writing")
    .option("-y, --yes", "install without confirmation")
    .option("--dry-run", "show the proposal without writing")
    .option("--from-json", "install an already-reviewed proposal read as JSON from stdin")
    .action(
      async (
        idea: string[],
        options: {
          stdin?: boolean;
          json?: boolean;
          yes?: boolean;
          dryRun?: boolean;
          fromJson?: boolean;
        }
      ) => {
        await buildCommand(idea ?? [], options);
      }
    );

  program
    .command("list")
    .description("list current skills with short descriptions")
    .action(async () => {
      await listCommand();
    });

  program
    .command("show <skill>")
    .description("print one canonical SKILL.md for inspection or agent use")
    .option("--json", "print parsed skill content as JSON")
    .option("--path", "print only the canonical SKILL.md path")
    .action(async (skill: string, options: { json?: boolean; path?: boolean }) => {
      await showCommand(skill, options);
    });

  program
    .command("check [skill]")
    .description("validate canonical skills and flag discovery or context-quality issues")
    .option("--json", "print a machine-readable report")
    .action(async (skill: string | undefined, options: { json?: boolean }) => {
      await checkCommand(skill, options);
    });

  program
    .command("catalog")
    .description("show canonical skills grouped by kind")
    .action(async () => {
      await catalogCommand();
    });

  program
    .command("status")
    .description("show connected mirrors and skill state")
    .action(async () => {
      await statusCommand();
    });

  program
    .command("connect <agent>")
    .description(`connect a shared-skill mirror (${supportedAgents().join(" | ")})`)
    .option("-p, --path <path>", "override the default mirror path")
    .action(async (agent: string, options: { path?: string }) => {
      await connectCommand(agent, options);
    });

  program
    .command("disconnect <agent>")
    .description("disconnect an agent mirror without deleting its files")
    .option("-p, --path <path>", "only disconnect the matching path")
    .action(async (agent: string, options: { path?: string }) => {
      await disconnectCommand(agent, options);
    });

  program
    .command("add [source]")
    .description(
      "add a skill from a local path, a GitHub repo or URL, a skills.sh page, a tweet that links to one, or stdin"
    )
    .option("--stdin", "read a complete SKILL.md from stdin")
    .option("--skill <name>", "pick one skill when a remote repo holds several")
    .option("--always", "make it always-on: its body goes into every agent's global instructions file")
    .option("--build", "if a tweet has no skill link, build a skill from its text")
    .action(
      async (
        source: string | undefined,
        options: { stdin?: boolean; skill?: string; always?: boolean; build?: boolean }
      ) => {
        await addCommand(source, options);
      }
    );

  program
    .command("always <skill>")
    .description("make a skill always-on (in every session), or return it to on-demand with --off")
    .option("--off", "load on demand again")
    .action(async (skill: string, options: { off?: boolean }) => {
      await alwaysCommand(skill, options);
    });

  program
    .command("edit <skill>")
    .description("edit interactively, replace SKILL.md from stdin, or replace from a source path")
    .option("--stdin", "read a complete replacement SKILL.md from stdin")
    .option("--source <path>", "replace from a complete skill directory or SKILL.md file")
    .action(async (skill: string, options: { stdin?: boolean; source?: string }) => {
      await editCommand(skill, options);
    });

  program
    .command("rename <skill> <new-name>")
    .description("rename a canonical skill and move it in every connected agent")
    .action(async (skill: string, newName: string) => {
      await renameCommand(skill, newName);
    });

  program
    .command("remove <skill>")
    .description("remove a canonical skill and prune it from connected mirrors")
    .option("--block", "also never adopt this skill back from a mirror")
    .action(async (skill: string, options: { block?: boolean }) => {
      await removeCommand(skill, options);
    });

  program
    .command("doctor")
    .description("check store health, LLM connectivity, and mirror state")
    .option("-v, --verbose", "show extra detail")
    .option("--repair", "relink a moved store, then reconcile canonical skills with connected mirrors")
    .option("--store <path>", "with --repair: point the store's skills link at this folder")
    .action(async (options: { verbose?: boolean; repair?: boolean; store?: string }) => {
      await doctorCommand(options);
    });

  const desktop = program
    .command("desktop")
    .description("machine-readable backend for the native Skillset desktop app");

  desktop
    .command("snapshot")
    .description("print connections and the skill library as JSON")
    .action(async () => {
      await desktopSnapshotCommand();
    });

  desktop
    .command("save")
    .description("update one skill's name, description, or body from JSON on stdin")
    .action(async () => {
      await desktopSaveCommand();
    });

  return program;
}

export function isCliEntrypoint(metaUrl: string, argvPath = process.argv[1]): boolean {
  if (!argvPath) return false;

  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(resolve(argvPath));
  } catch {
    return false;
  }
}

if (isCliEntrypoint(import.meta.url)) {
  createProgram().parseAsync(process.argv).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(pc.red(`error: ${message}`));
    process.exitCode = 1;
  });
}
