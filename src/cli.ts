import { Command } from "commander";
import pc from "picocolors";
import { initCommand } from "./commands/init.js";
import { linkCommand, unlinkCommand } from "./commands/link.js";
import { syncCommand } from "./commands/sync.js";
import { statusCommand } from "./commands/status.js";
import { listCommand } from "./commands/list.js";

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

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(pc.red(`error: ${message}`));
  process.exitCode = 1;
});
