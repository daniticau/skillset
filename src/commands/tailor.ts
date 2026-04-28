import pc from "picocolors";
import { defaultLLMConfig, isAvailable } from "../mine/llm/index.js";
import {
  executeCreate,
  executeEdit,
  loadExistingSkillSummaries,
  planSkillAction,
} from "../mine/make.js";
import { createDirectSkillCluster } from "../mine/direct-skill.js";
import { mineCommand } from "./mine.js";
import { makeCommand } from "./make.js";
import { syncCommand } from "./sync.js";

export interface TailorCmdOptions {
  stdin?: boolean;
  dryRun?: boolean;
  full?: boolean;
  force?: boolean;
  project?: string;
  max?: number;
}

function truncate(s: string, max: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : clean.slice(0, max - 1) + "...";
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function collectInput(parts: string[], options: TailorCmdOptions): Promise<string> {
  const argText = parts.join(" ").trim();
  const shouldReadStdin = options.stdin || (!argText && process.stdin.isTTY !== true);
  const stdinText = shouldReadStdin ? (await readStdin()).trim() : "";
  return [argText, stdinText].filter(Boolean).join("\n\n").trim();
}

async function tailorExplicit(input: string, options: TailorCmdOptions): Promise<void> {
  const config = defaultLLMConfig();
  const avail = await isAvailable(config);
  if (!avail.reachable) {
    console.log(pc.red(`LLM unreachable: ${avail.reason ?? "unknown"}`));
    if (config.provider === "anthropic") {
      console.log(pc.dim("  set ANTHROPIC_API_KEY in ~/.skillset/.env or your shell"));
    } else {
      console.log(pc.dim("  run `sks doctor` for setup details"));
    }
    return;
  }

  const cluster = createDirectSkillCluster(input);
  const summaries = await loadExistingSkillSummaries();
  const action = await planSkillAction(cluster, summaries, config, 1);
  const signal = truncate(input, 90);

  if (action.kind === "skip") {
    console.log(`${pc.dim("SKIP")} ${pc.dim(signal)}`);
    if (action.reason) console.log(pc.dim(`  ${action.reason}`));
    return;
  }

  let changed = false;
  if (action.kind === "edit") {
    console.log(`${pc.cyan("EDIT")} ${pc.bold(action.targetName)} ${pc.dim(signal)}`);
    if (action.rationale) console.log(pc.dim(`  ${action.rationale}`));
    if (!options.dryRun) {
      const { path } = await executeEdit(action.targetName, cluster, config);
      console.log(pc.dim(`  -> ${path}`));
      changed = true;
    }
  } else {
    console.log(
      `${pc.green("CREATE")} ${pc.bold(action.name)} ${pc.dim(`(${action.tier})`)} ${pc.dim(signal)}`
    );
    if (action.rationale) console.log(pc.dim(`  ${action.rationale}`));
    if (!options.dryRun) {
      const { path } = await executeCreate(action, cluster, config, {
        origin: "user-created",
      });
      console.log(pc.dim(`  -> ${path}`));
      changed = true;
    }
  }

  if (options.dryRun) {
    console.log(pc.yellow("dry-run - no files written"));
    return;
  }

  if (changed) {
    console.log();
    console.log(pc.dim("mirroring changes..."));
    await syncCommand();
  }
}

async function tailorHistory(options: TailorCmdOptions): Promise<void> {
  if (options.dryRun) {
    console.log(pc.yellow("dry-run - no sessions, skills, state, or mirrors will be changed"));
    await mineCommand({
      project: options.project,
      force: options.force,
      dryRun: true,
      noScrape: true,
    });
    await makeCommand({
      maxNew: options.max,
      dryRun: true,
      force: options.force,
    });
    return;
  }

  await mineCommand({
    project: options.project,
    force: options.force,
    fullScrape: options.full,
  });
  await makeCommand({
    maxNew: options.max,
    force: options.force,
  });
}

export async function tailorCommand(
  parts: string[],
  options: TailorCmdOptions = {}
): Promise<void> {
  const input = await collectInput(parts, options);
  if (input) {
    await tailorExplicit(input, options);
    return;
  }
  await tailorHistory(options);
}
