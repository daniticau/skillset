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

const execFileP = promisify(execFile);

const STORE_GITIGNORE = ["state.json", ""].join("\n");

export interface InitOptions {
  noAutoLink?: boolean;
}

export async function initCommand(options: InitOptions = {}): Promise<void> {
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

  if (options.noAutoLink) {
    console.log(pc.dim("  auto-link skipped (run `skillissue link <agent>` manually)"));
    return;
  }

  const detected = await detectAgents();
  if (detected.length === 0) {
    console.log(pc.dim("  no coding agents detected — run `skillissue link <agent>` manually"));
    return;
  }

  const fresh = await readConfig();
  const linkKey = (l: Link) => `${l.agent}:${l.path}`;
  const existing = new Set(fresh.links.map(linkKey));
  let added = 0;
  for (const link of detected) {
    if (!existing.has(linkKey(link))) {
      fresh.links.push(link);
      added += 1;
      console.log(
        pc.green(
          `✓ linked ${getAdapter(link.agent).displayName} → ${pc.dim(link.path)}`
        )
      );
    } else {
      console.log(
        pc.dim(`• ${getAdapter(link.agent).displayName} already linked`)
      );
    }
  }
  if (added > 0) await writeConfig(fresh);

  console.log(pc.dim("  next: `skillissue sync`"));
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
