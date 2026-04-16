import { Command } from "commander";
import pc from "picocolors";
import { loadEnv } from "./core/env.js";
import { initCommand } from "./commands/init.js";
import { linkCommand, unlinkCommand } from "./commands/link.js";
import { syncCommand } from "./commands/sync.js";
import { statusCommand } from "./commands/status.js";
import { listCommand } from "./commands/list.js";
import { scrapeCommand } from "./commands/scrape.js";
import { mineCommand } from "./commands/mine.js";
import { draftsCommand, promoteCommand, discardDraftCommand } from "./commands/drafts.js";
import { doctorCommand } from "./commands/doctor.js";
import type { ScrapeSource } from "./ingest/sessions/types.js";

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
  .description("link a coding agent mirror (v1: claude-code)")
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
  .command("scrape")
  .description("scrape coding-session transcripts into ~/.skillset/sessions")
  .option("-s, --source <name>", "only scrape one source (claude-code | codex | cursor)")
  .option("--full", "ignore stored cursors and re-scrape everything")
  .action(async (options: { source?: string; full?: boolean }) => {
    await scrapeCommand({
      source: options.source as ScrapeSource | undefined,
      full: options.full,
    });
  });

program
  .command("mine")
  .description("extract signal (corrections, preferences, patterns) from session transcripts")
  .option("-p, --project <slug>", "only mine a specific project slug")
  .option("-v, --verbose", "show evidence details for each nugget")
  .option("--llm", "also run LLM-based extraction via local Ollama")
  .option("--synthesize", "generate draft SKILL.md files from top clusters (implies --llm)")
  .option("--force", "reprocess all sessions, ignoring incremental state")
  .option("--dry-run", "print what would be processed without doing it")
  .action(
    async (options: {
      project?: string;
      verbose?: boolean;
      llm?: boolean;
      synthesize?: boolean;
      force?: boolean;
      dryRun?: boolean;
    }) => {
      // --synthesize implies --llm
      if (options.synthesize) options.llm = true;
      await mineCommand(options);
    }
  );

program
  .command("drafts")
  .description("list draft skills pending review (written by `mine --synthesize`)")
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
  .command("doctor")
  .description("check store health, LLM connectivity, mirror state, and session data")
  .option("-v, --verbose", "show extra detail (e.g., list all available Ollama models)")
  .action(async (options: { verbose?: boolean }) => {
    await doctorCommand(options);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(pc.red(`error: ${message}`));
  process.exitCode = 1;
});
