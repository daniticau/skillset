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
import { tailorCommand } from "./commands/tailor.js";
import { doctorCommand } from "./commands/doctor.js";
import { editCommand, removeCommand } from "./commands/manage.js";
import { dreamCommand } from "./commands/dream.js";
import {
  usageCommand,
  usageRecordCommand,
  usageScanCommand,
} from "./commands/usage.js";

// Load ~/.skillset/.env before any command reads process.env.
loadEnv();

export function createProgram(): Command {
  const program = new Command();

  program
    .name("sks")
    .description("portable personalization layer for coding agents")
    .version("0.1.1");

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
    .command("tailor [text...]")
    .description("learn from past sessions, or turn explicit text/stdin into a skill")
    .option("--stdin", "read an explicit tailoring instruction from stdin")
    .option("--dry-run", "preview without writing sessions, skills, state, or mirrors")
    .option("--full", "re-scrape all session history instead of using incremental cursors")
    .option("--force", "reprocess sessions/clusters already seen")
    .option("-p, --project <slug>", "only tailor from one project slug")
    .option("--max <n>", "max new skills to create (default 3)", (v) => parseInt(v, 10))
    .action(
      async (
        text: string[],
        options: {
          stdin?: boolean;
          dryRun?: boolean;
          full?: boolean;
          force?: boolean;
          project?: string;
          max?: number;
        }
      ) => {
        await tailorCommand(text ?? [], options);
      }
    );

  program
    .command("dream")
    .description("set up or run the macOS nightly skill improvement loop")
    .option("--at <HH:MM>", "install or update the nightly LaunchAgent time", "02:00")
    .option("--status", "show dream schedule and reviewed days")
    .option("--off", "disable the dream LaunchAgent")
    .option("--run-now", "run the nightly improvement immediately")
    .option("--scheduled", "mark this invocation as launched by the scheduler")
    .option("--force", "run even if today was already reviewed")
    .action(async (options: {
      at?: string;
      status?: boolean;
      off?: boolean;
      runNow?: boolean;
      scheduled?: boolean;
      force?: boolean;
    }) => {
      await dreamCommand(options);
    });

  program
    .command("list")
    .description("list current skills with short descriptions")
    .action(async () => {
      await listCommand();
    });

  program
    .command("catalog")
    .description("show canonical skills grouped by likely use case")
    .action(async () => {
      await catalogCommand();
    });

  program
    .command("status")
    .description("show connected mirrors and skill state")
    .option("--usage", "show observed usage counts and last-used dates")
    .action(async (options: { usage?: boolean }) => {
      await statusCommand(options);
    });

  const usage = program
    .command("usage")
    .description("show or record observed skill usage")
    .argument("[skill]", "show observed usage timeline for one skill")
    .action(async (skill?: string) => {
      await usageCommand(skill);
    });

  usage
    .command("scan")
    .description("infer skill usage from scraped sessions")
    .option("--scrape", "scrape transcripts before scanning for usage")
    .option("--full-scrape", "when scraping first, re-scrape all session history")
    .option("--force", "rescan sessions already seen")
    .option("-p, --project <slug>", "only scan one project slug")
    .action(
      async (options: {
        scrape?: boolean;
        fullScrape?: boolean;
        force?: boolean;
        project?: string;
      }) => {
        await usageScanCommand(options);
      }
    );

  usage
    .command("record <skill>")
    .description("record a high-confidence observed skill use")
    .option("--agent <agent>", "agent that used the skill")
    .option("--at <date>", "usage time; any date string accepted by JavaScript Date")
    .option("-p, --project <slug>", "project associated with the usage")
    .option("--evidence <text>", "short evidence or note for the usage")
    .action(
      async (
        skill: string,
        options: {
          agent?: string;
          at?: string;
          project?: string;
          evidence?: string;
        }
      ) => {
        await usageRecordCommand(skill, options);
      }
    );

  program
    .command("connect <agent>")
    .description("connect an agent mirror (claude-code | codex)")
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
    .command("edit <skill>")
    .description("open a canonical skill in $VISUAL or $EDITOR, then mirror changes")
    .action(async (skill: string) => {
      await editCommand(skill);
    });

  program
    .command("remove <skill>")
    .description("remove a canonical skill and prune it from connected mirrors")
    .action(async (skill: string) => {
      await removeCommand(skill);
    });

  program
    .command("doctor")
    .description("check store health, LLM connectivity, mirror state, and session data")
    .option("-v, --verbose", "show extra detail")
    .option("--repair", "reconcile canonical skills with connected mirrors")
    .action(async (options: { verbose?: boolean; repair?: boolean }) => {
      await doctorCommand(options);
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
