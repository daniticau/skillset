import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import pc from "picocolors";
import { readConfig, writeConfig } from "../core/config.js";
import type { AgentKind, Link } from "../core/config.js";
import { ensureStore, storeRoot } from "../core/store.js";
import { ensureBuiltinSkills } from "../core/builtin-skills.js";
import { defaultAutoLinkAgents, getAdapter } from "../core/adapters/index.js";
import { checkbox } from "../core/ux/prompt.js";
import { sync } from "../core/mirror.js";
import { printSyncReport } from "./sync.js";

const execFileP = promisify(execFile);

const STORE_GITIGNORE = ["state.json", ""].join("\n");

export interface InitOptions {
  noAutoLink?: boolean;
  nonInteractive?: boolean;
}

interface LinkCandidate extends Link {
  checked: boolean;
  detected: boolean;
}

async function detectAgents(includeOptional: boolean): Promise<LinkCandidate[]> {
  const links: LinkCandidate[] = [];
  for (const kind of defaultAutoLinkAgents()) {
    const adapter = getAdapter(kind as AgentKind);
    const hit = await adapter.detect();
    if (hit) {
      links.push({ agent: adapter.kind, path: hit.path, checked: true, detected: true });
      continue;
    }
    if (includeOptional && adapter.kind === "claude-code") {
      links.push({
        agent: adapter.kind,
        path: adapter.defaultPath,
        checked: false,
        detected: false,
      });
    }
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
  const installed = await ensureBuiltinSkills();
  for (const skill of installed) {
    console.log(pc.green(`✓ installed built-in skill ${skill.name}`));
  }
  console.log(pc.green(`✓ canonical store ready at ${root}`));
}

async function doLinks(candidates: LinkCandidate[], interactive: boolean): Promise<number> {
  const fresh = await readConfig();
  const linkKey = (l: Link) => `${l.agent}:${l.path}`;
  const existing = new Set(fresh.links.map(linkKey));
  const alreadyLinked = candidates.filter((link) => existing.has(linkKey(link)));
  const linkable = candidates.filter((link) => !existing.has(linkKey(link)));

  if (alreadyLinked.length > 0) {
    const names = alreadyLinked.map((link) => getAdapter(link.agent).displayName).join(", ");
    console.log(pc.dim(`  already connected: ${names}`));
  }

  if (candidates.length === 0) {
    console.log(pc.dim("  no coding agents detected"));
    return 0;
  }
  if (linkable.length === 0) {
    console.log(pc.dim("  no new agent mirrors to link"));
    return 0;
  }

  let pickedLinks: LinkCandidate[];
  if (interactive) {
    pickedLinks = await checkbox(
      "Which agents should be linked as mirror targets?",
      linkable.map((link) => ({
        label: `${getAdapter(link.agent).displayName} ${pc.dim(
          `(${link.path}${link.detected ? "" : " — optional"})`
        )}`,
        value: link,
        checked: link.checked,
      }))
    );
  } else {
    pickedLinks = linkable.filter((link) => link.checked);
  }

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
  if (added === 0) console.log(pc.dim("  no new mirrors linked"));
  return added;
}

export async function initCommand(options: InitOptions = {}): Promise<void> {
  const interactive = !options.nonInteractive && process.stdin.isTTY === true;

  await setupStore();

  if (options.noAutoLink) {
    console.log(pc.dim("  auto-connect skipped (run `sks connect <agent>` manually)"));
    printSyncReport(await sync({ importExisting: true }));
    return;
  }

  const detected = await detectAgents(interactive);
  await doLinks(detected, interactive);

  console.log(pc.dim("reconciling existing skills from connected agents..."));
  printSyncReport(await sync({ importExisting: true }));

  console.log();
  console.log(pc.dim("next:"));
  console.log(pc.dim(`  • ${pc.bold("sks tailor")} to learn from past sessions`));
  console.log(pc.dim(`  • ${pc.bold("sks status")} to see what's tracked`));
}
