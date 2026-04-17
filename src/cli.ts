import { Command } from "commander";
import pc from "picocolors";
import { loadEnv } from "./core/env.js";
import { initCommand } from "./commands/init.js";
import { linkCommand, unlinkCommand } from "./commands/link.js";
import { syncCommand } from "./commands/sync.js";
import { statusCommand } from "./commands/status.js";
import { listCommand } from "./commands/list.js";
import { mineCommand } from "./commands/mine.js";
import { synthesizeCommand } from "./commands/synthesize.js";
import { makeCommand } from "./commands/make.js";
import { deepDiveCommand } from "./commands/deep-dive.js";
import { cycleCommand } from "./commands/cycle.js";
import { scheduleCommand } from "./commands/schedule.js";
import { draftsCommand, promoteCommand, discardDraftCommand } from "./commands/drafts.js";
import { doctorCommand } from "./commands/doctor.js";

// Load ~/.skillset/.env before any command reads process.env
loadEnv();

const program = new Command();

program
  .name("skillset")
  .description("portable personalization layer for coding agents")
  .version("0.1.0");

program
  .command("init")
  .description("initialize the store and auto-link any detected coding agents")
  .option("--no-auto-link", "skip auto-linking detected agents")
  .action(async (options: { autoLink?: boolean }) => {
    await initCommand({ noAutoLink: options.autoLink === false });
  });

program
  .command("link <agent>")
  .description("link a coding agent mirror (claude-code | cursor | codex)")
  .option("-p, --path <path>", "override the default mirror path")
  .action(async (agent: string, options: { path?: string }) => {
    await linkCommand(agent, options);
  });

program
  .command("unlink <agent>")
  .description("remove a linked mirror")
  .option("-p, --path <path>", "only unlink the matching path")
  .action(async (agent: string, options: { path?: string }) => {
    await unlinkCommand(agent, options);
  });

program
  .command("sync")
  .description("sync the canonical store to all linked mirrors (promotes user edits)")
  .action(async () => {
    await syncCommand();
  });

program
  .command("status")
  .description("show linked mirrors and skill state")
  .action(async () => {
    await statusCommand();
  });

program
  .command("list")
  .description("list skills in the canonical store")
  .action(async () => {
    await listCommand();
  });

program
  .command("mine")
  .description("scrape transcripts from all linked agents and extract signal (corrections, preferences, patterns)")
  .option("-p, --project <slug>", "only mine a specific project slug")
  .option("-v, --verbose", "show evidence details for each nugget")
  .option("--llm", "also run LLM-based extraction (via configured provider)")
  .option("--force", "reprocess all sessions, ignoring incremental state")
  .option("--no-scrape", "skip the scrape step; mine whatever is already in ~/.skillset/sessions")
  .option("--full-scrape", "ignore stored cursors and re-scrape every session from every source")
  .option("--dry-run", "print what would be processed without doing it")
  .action(
    async (options: {
      project?: string;
      verbose?: boolean;
      llm?: boolean;
      force?: boolean;
      scrape?: boolean;
      fullScrape?: boolean;
      dryRun?: boolean;
    }) => {
      await mineCommand({
        project: options.project,
        verbose: options.verbose,
        llm: options.llm,
        force: options.force,
        dryRun: options.dryRun,
        noScrape: options.scrape === false,
        fullScrape: options.fullScrape,
      });
    }
  );

program
  .command("synthesize")
  .description("turn top nugget clusters into draft SKILL.md files in ~/.skillset/drafts/")
  .option("--max <n>", "max draft skills to produce (default 10)", (v) => parseInt(v, 10))
  .option("--min-members <n>", "minimum cluster members required (default 2)", (v) => parseInt(v, 10))
  .action(async (options: { max?: number; minMembers?: number }) => {
    await synthesizeCommand(options);
  });

program
  .command("make")
  .description("triage mined clusters into skill edits or new skills via LLM (auto-promotes new skills to canonical + syncs)")
  .option("--max-new <n>", "max new skills to create per run (default 3)", (v) => parseInt(v, 10))
  .option("--min-score <f>", "minimum cluster score to consider (default 0.5)", (v) => parseFloat(v))
  .option("--limit <n>", "max clusters to consider per run (default 20)", (v) => parseInt(v, 10))
  .option("--dry-run", "print triage decisions without writing files or state")
  .option("--force", "reconsider clusters already processed in a prior run")
  .option("--draft", "write new skills to ~/.skillset/drafts/ for manual review instead of auto-promoting")
  .action(
    async (options: {
      maxNew?: number;
      minScore?: number;
      limit?: number;
      dryRun?: boolean;
      force?: boolean;
      draft?: boolean;
    }) => {
      await makeCommand(options);
    }
  );

program
  .command("cycle")
  .description("run the nightly self-improvement cycle (scrape + mine + synthesize + sync + commit)")
  .option("--nightly", "run as a nightly cycle (currently the only cycle kind)")
  .option("--no-idle-check", "skip the CPU/input idle gate (useful for manual runs)")
  .option("--dry-run", "print the plan without writing files or committing")
  .option("--scheduled", "invoked by the scheduled task — exit 0 on benign skips (lock/idle)")
  .action(
    async (options: {
      nightly?: boolean;
      idleCheck?: boolean;
      dryRun?: boolean;
      scheduled?: boolean;
    }) => {
      await cycleCommand({
        nightly: options.nightly,
        noIdleCheck: options.idleCheck === false,
        dryRun: options.dryRun,
        scheduled: options.scheduled,
      });
    }
  );

program
  .command("deep-dive")
  .description("one-shot onboarding pass: ingest ALL history and generate foundational skills (resumable)")
  .option("--max <n>", "cap on new skills this run (default 10)", (v) => parseInt(v, 10))
  .option("--restart", "discard any prior checkpoint and start fresh")
  .option("--dry-run", "print the plan without writing files or committing")
  .action(async (options: { max?: number; restart?: boolean; dryRun?: boolean }) => {
    await deepDiveCommand(options);
  });

program
  .command("drafts")
  .description("list draft skills pending review (written by `synthesize`)")
  .option("--rm <name>", "discard a draft instead of listing")
  .action(async (options: { rm?: string }) => {
    if (options.rm) {
      await discardDraftCommand(options.rm);
    } else {
      await draftsCommand();
    }
  });

program
  .command("promote <name>")
  .description("promote a draft skill to the canonical store and sync to all mirrors")
  .option("--no-sync", "skip running `sync` after promotion")
  .action(async (name: string, options: { sync?: boolean }) => {
    await promoteCommand(name, { noSync: options.sync === false });
  });

program
  .command("schedule <action>")
  .description("manage the Windows scheduled task that fires `sks cycle --nightly` (actions: install, uninstall, status)")
  .option("--at <HH:MM>", "time of day to fire (default 02:00)")
  .action(async (action: string, options: { at?: string }) => {
    if (action !== "install" && action !== "uninstall" && action !== "status") {
      console.error(`error: invalid action "${action}" — use install, uninstall, or status`);
      process.exitCode = 1;
      return;
    }
    await scheduleCommand({ action, atTime: options.at });
  });

program
  .command("doctor")
  .description("check store health, LLM connectivity, mirror state, and session data")
  .option("-v, --verbose", "show extra detail")
  .action(async (options: { verbose?: boolean }) => {
    await doctorCommand(options);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(pc.red(`error: ${message}`));
  process.exitCode = 1;
});
