import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import pc from "picocolors";
import { readConfig, writeConfig } from "../core/config.js";
import type { AgentKind, Link } from "../core/config.js";
import { ensureStore, storeRoot } from "../core/store.js";
import { getAdapter, supportedAgents } from "../core/adapters/index.js";
import { confirm, checkbox } from "../core/ux/prompt.js";
import { installTask } from "../core/scheduler/windows.js";
import { runDeepDive, consoleStageLogger } from "../mine/cycle/deep-dive.js";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const execFileP = promisify(execFile);

const STORE_GITIGNORE = ["state.json", ""].join("\n");

export interface InitOptions {
  noAutoLink?: boolean;
  nonInteractive?: boolean;
}

function resolveCliPath(): string {
  try {
    return resolve(fileURLToPath(import.meta.url));
  } catch {
    return join(process.cwd(), "dist", "cli.js");
  }
}

async function detectAgents(): Promise<Link[]> {
  const links: Link[] = [];
  for (const kind of supportedAgents()) {
    const adapter = getAdapter(kind as AgentKind);
    const hit = await adapter.detect();
    if (hit) links.push({ agent: adapter.kind, path: hit.path });
  }
  return links;
}

async function setupStore(): Promise<void> {
  await ensureStore();
  const root = storeRoot();

  const gitDir = join(root, ".git");
  if (!existsSync(gitDir)) {
    try {
      await execFileP("git", ["init", "--initial-branch=main", root]);
      console.log(pc.green(`✓ initialized git repo at ${root}`));
    } catch {
      console.log(pc.yellow(`• could not run \`git init\` — skipping version control`));
    }
  } else {
    console.log(pc.dim(`• git repo already exists at ${root}`));
  }

  const gitignorePath = join(root, ".gitignore");
  if (!existsSync(gitignorePath)) {
    await writeFile(gitignorePath, STORE_GITIGNORE, "utf8");
    console.log(pc.green(`✓ wrote ${gitignorePath}`));
  }

  const config = await readConfig();
  await writeConfig(config);
  console.log(pc.green(`✓ canonical store ready at ${root}`));
}

async function doLinks(detected: Link[], interactive: boolean): Promise<number> {
  if (detected.length === 0) {
    console.log(pc.dim("  no coding agents detected"));
    return 0;
  }

  let pickedLinks: Link[];
  if (interactive) {
    pickedLinks = await checkbox(
      "Which agents should be linked as mirror targets?",
      detected.map((link) => ({
        label: `${getAdapter(link.agent).displayName} ${pc.dim(`(${link.path})`)}`,
        value: link,
        checked: true,
      }))
    );
  } else {
    pickedLinks = detected;
  }

  const fresh = await readConfig();
  const linkKey = (l: Link) => `${l.agent}:${l.path}`;
  const existing = new Set(fresh.links.map(linkKey));
  let added = 0;
  for (const link of pickedLinks) {
    if (!existing.has(linkKey(link))) {
      fresh.links.push(link);
      added += 1;
      console.log(
        pc.green(
          `✓ linked ${getAdapter(link.agent).displayName} → ${pc.dim(link.path)}`
        )
      );
    } else {
      console.log(pc.dim(`• ${getAdapter(link.agent).displayName} already linked`));
    }
  }
  if (added > 0) await writeConfig(fresh);
  return added;
}

async function maybeInstallScheduler(interactive: boolean): Promise<void> {
  if (process.platform !== "win32") return;
  const shouldInstall = interactive
    ? await confirm("Register Windows nightly scheduled task (fires 2am)?", true)
    : false;
  if (!shouldInstall) return;
  try {
    const cliPath = resolveCliPath();
    const { taskName } = await installTask({ cliPath });
    console.log(pc.green(`✓ scheduled task installed: ${taskName}`));
  } catch (err) {
    console.log(
      pc.yellow(
        `• could not install scheduled task: ${err instanceof Error ? err.message : String(err)}`
      )
    );
    console.log(pc.dim(`  run \`sks schedule install\` manually later`));
  }
}

async function maybeRunDeepDive(interactive: boolean): Promise<void> {
  const shouldRun = interactive
    ? await confirm(
        "Run the deep-dive now? (reads all Claude Code / Codex / Cursor history — can take tens of minutes)",
        false
      )
    : false;
  if (!shouldRun) {
    console.log(pc.dim("  (skipped — run `sks deep-dive` when ready)"));
    return;
  }
  await runDeepDive({ onStage: consoleStageLogger });
}

export async function initCommand(options: InitOptions = {}): Promise<void> {
  const interactive = !options.nonInteractive && process.stdin.isTTY === true;

  await setupStore();

  if (options.noAutoLink) {
    console.log(pc.dim("  auto-link skipped (run `skillset link <agent>` manually)"));
    return;
  }

  const detected = await detectAgents();
  await doLinks(detected, interactive);

  await maybeInstallScheduler(interactive);
  await maybeRunDeepDive(interactive);

  console.log();
  console.log(pc.dim("next:"));
  console.log(pc.dim(`  • ${pc.bold("sks sync")} to push canonical → mirrors`));
  console.log(pc.dim(`  • ${pc.bold("sks status")} to see what's tracked`));
  console.log(pc.dim(`  • ${pc.bold("sks cycle --nightly")} to run a cycle manually`));
}
