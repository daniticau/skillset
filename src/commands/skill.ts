import pc from "picocolors";
import { defaultLLMConfig, isAvailable } from "../mine/llm/index.js";
import {
  executeCreate,
  executeEdit,
  loadExistingSkillSummaries,
  planSkillAction,
} from "../mine/make.js";
import { createDirectSkillCluster } from "../mine/direct-skill.js";
import { syncCommand } from "./sync.js";

export interface SkillCmdOptions {
  dryRun?: boolean;
  stdin?: boolean;
  noSync?: boolean;
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

async function collectInput(parts: string[], options: SkillCmdOptions): Promise<string> {
  const argText = parts.join(" ").trim();
  const shouldReadStdin = options.stdin || (!argText && process.stdin.isTTY !== true);
  const stdinText = shouldReadStdin ? (await readStdin()).trim() : "";
  return [argText, stdinText].filter(Boolean).join("\n\n").trim();
}

export async function skillCommand(
  parts: string[],
  options: SkillCmdOptions = {}
): Promise<void> {
  const input = await collectInput(parts, options);
  if (!input) {
    console.log(pc.yellow("nothing to skill - pass text or pipe it with --stdin"));
    return;
  }

  const config = defaultLLMConfig();
  const avail = await isAvailable(config);
  if (!avail.reachable) {
    console.log(pc.red(`LLM unreachable: ${avail.reason ?? "unknown"}`));
    if (config.provider === "anthropic") {
      console.log(pc.dim("  set ANTHROPIC_API_KEY in ~/.skillset/.env or your shell"));
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

  let shouldSync = false;
  if (action.kind === "edit") {
    console.log(`${pc.cyan("EDIT")} ${pc.bold(action.targetName)} ${pc.dim(signal)}`);
    if (action.rationale) console.log(pc.dim(`  ${action.rationale}`));
    if (!options.dryRun) {
      const { path } = await executeEdit(action.targetName, cluster, config);
      console.log(pc.dim(`  -> ${path}`));
      shouldSync = true;
    }
  } else {
    console.log(
      `${pc.green("CREATE")} ${pc.bold(action.name)} ${pc.dim(`(${action.tier})`)} ${pc.dim(signal)}`
    );
    if (action.rationale) console.log(pc.dim(`  ${action.rationale}`));
    if (!options.dryRun) {
      const { path, skill } = await executeCreate(action, cluster, config, {
        origin: "user-created",
      });
      console.log(pc.dim(`  -> ${path}`));
      void skill;
      shouldSync = true;
    }
  }

  if (options.dryRun) {
    console.log(pc.yellow("dry-run - no files written"));
    return;
  }

  if (shouldSync && !options.noSync) {
    console.log();
    console.log(pc.dim("syncing mirrors..."));
    await syncCommand();
  }
}
