import pc from "picocolors";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { STORE_ROOT } from "../core/paths.js";
import { defaultLLMConfig, isAvailable } from "../mine/llm/index.js";
import type { NuggetCluster } from "../mine/types.js";
import {
  readMakeState,
  writeMakeState,
  needsMaking,
  recordAction,
  invalidateDeletedTargets,
  finalizeMakeRun,
  clusterFingerprint,
} from "../mine/make-state.js";
import {
  loadExistingSkillSummaries,
  planSkillAction,
  executeEdit,
  executeCreate,
} from "../mine/make.js";
import { promoteDraft } from "../mine/synthesize.js";
import { syncCommand } from "./sync.js";

const CLUSTERS_FILE = join(STORE_ROOT, "nuggets", "clusters.json");

export interface MakeCmdOptions {
  maxNew?: number;
  minScore?: number;
  limit?: number;
  dryRun?: boolean;
  force?: boolean;
  /** When true, CREATE lands in ~/.skillset/drafts/ and requires manual `sks promote`. Default false (auto-promote). */
  draft?: boolean;
}

function truncate(s: string, max: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : clean.slice(0, max - 1) + "…";
}

export async function makeCommand(options: MakeCmdOptions): Promise<void> {
  if (!existsSync(CLUSTERS_FILE)) {
    console.log(pc.yellow(`no clusters yet — run ${pc.bold("skillset mine")} first`));
    return;
  }
  let clusters: NuggetCluster[];
  try {
    const raw = await readFile(CLUSTERS_FILE, "utf8");
    clusters = JSON.parse(raw) as NuggetCluster[];
  } catch (err) {
    console.log(pc.red(`failed to read clusters: ${err instanceof Error ? err.message : String(err)}`));
    return;
  }
  if (clusters.length === 0) {
    console.log(pc.dim("cluster list is empty — nothing to consider"));
    return;
  }

  const config = defaultLLMConfig();
  const avail = await isAvailable(config);
  if (!avail.reachable) {
    console.log(pc.red(`LLM unreachable: ${avail.reason ?? "unknown"}`));
    if (config.provider === "anthropic") {
      console.log(
        pc.dim("  set ANTHROPIC_API_KEY in ~/.skillset/.env or your shell")
      );
    }
    return;
  }

  const summaries = await loadExistingSkillSummaries();
  const existingNames = new Set(summaries.map((s) => s.name));
  let state = await readMakeState();
  state = invalidateDeletedTargets(state, existingNames);

  const minScore = options.minScore ?? 0.5;
  const maxLimit = options.limit ?? 20;
  let eligible = clusters
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score);

  const totalAboveThreshold = eligible.length;
  if (!options.force) {
    eligible = eligible.filter((c) => needsMaking(c, state));
  }
  eligible = eligible.slice(0, maxLimit);

  if (eligible.length === 0) {
    if (totalAboveThreshold === 0) {
      console.log(
        pc.dim(
          `no clusters meet minimum score ${minScore} (${clusters.length} total) — lower with ${pc.bold("--min-score")}`
        )
      );
    } else {
      console.log(
        pc.dim(
          `all ${totalAboveThreshold} eligible cluster(s) already processed — use ${pc.bold("--force")} to re-process`
        )
      );
    }
    return;
  }

  console.log(
    pc.dim(
      `processing ${eligible.length} cluster(s) [${config.provider}:${config.model}] — ${summaries.length} existing skill(s)`
    )
  );
  if (options.dryRun) console.log(pc.yellow("  (dry-run — no files written, state not mutated)"));
  console.log();

  const maxNew = options.maxNew ?? 3;
  let createdCount = 0;
  let editedCount = 0;
  let skippedCount = 0;

  for (const cluster of eligible) {
    const budget = maxNew - createdCount;
    const sig = truncate(cluster.canonical.signal, 90);
    const scoreTag = pc.dim(`[score ${cluster.score.toFixed(2)}]`);

    let action;
    try {
      action = await planSkillAction(cluster, summaries, config, budget);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ${pc.red("✗ triage failed")} ${scoreTag} ${pc.dim(sig)}`);
      console.log(`       ${pc.red(msg)}`);
      skippedCount += 1;
      if (!options.dryRun) {
        state = recordAction(state, cluster, "skip", { reason: `triage exception: ${msg}` });
      }
      continue;
    }

    const fp = clusterFingerprint(cluster);

    if (action.kind === "skip") {
      console.log(`  ${pc.dim("SKIP  ")} ${scoreTag} ${pc.dim(sig)}`);
      if (action.reason) console.log(`         ${pc.dim(action.reason)}`);
      skippedCount += 1;
      if (!options.dryRun) {
        state = recordAction(state, cluster, "skip", { reason: action.reason });
      }
      continue;
    }

    if (action.kind === "edit") {
      const tag = `${pc.cyan("EDIT  ")} ${scoreTag}`;
      console.log(`  ${tag} ${pc.bold(action.targetName)} ← ${pc.dim(sig)}`);
      if (action.rationale) console.log(`         ${pc.dim(action.rationale)}`);
      if (options.dryRun) continue;
      try {
        const { path } = await executeEdit(action.targetName, cluster, config);
        console.log(`         ${pc.dim(`→ ${path}`)}`);
        editedCount += 1;
        state = recordAction(state, cluster, "edit", { targetSkill: action.targetName });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`         ${pc.red(`edit failed: ${msg}`)}`);
        skippedCount += 1;
        state = recordAction(state, cluster, "skip", { reason: `edit execution failed: ${msg}` });
      }
      continue;
    }

    // create
    const createLabel = options.draft ? "CREATE" : "CREATE+";
    console.log(`  ${pc.green(createLabel)} ${scoreTag} ${pc.bold(action.name)}  ${pc.dim(sig)}`);
    if (action.rationale) console.log(`         ${pc.dim(action.rationale)}`);
    if (options.dryRun) continue;
    try {
      const { path, skill } = await executeCreate(action, cluster, config);
      if (options.draft) {
        console.log(`         ${pc.dim(`→ ${path}`)}`);
      } else {
        const canonicalPath = await promoteDraft(skill.name);
        console.log(`         ${pc.dim(`→ ${canonicalPath}`)}`);
      }
      createdCount += 1;
      state = recordAction(state, cluster, "create", { targetSkill: skill.name });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`         ${pc.red(`create failed: ${msg}`)}`);
      skippedCount += 1;
      state = recordAction(state, cluster, "skip", { reason: `create execution failed: ${msg}` });
    }
    // avoid unused import warning
    void fp;
  }

  if (!options.dryRun) {
    state = finalizeMakeRun(state);
    await writeMakeState(state);
  }

  console.log();
  const createdVerb = options.draft ? "drafted" : "created";
  console.log(
    pc.bold(
      `${editedCount} edited · ${createdCount} ${createdVerb} · ${skippedCount} skipped`
    )
  );

  const shouldSync =
    !options.dryRun && (editedCount > 0 || (createdCount > 0 && !options.draft));
  if (shouldSync) {
    console.log();
    console.log(pc.dim("syncing mirrors…"));
    await syncCommand();
  } else if (options.draft && createdCount > 0) {
    console.log(pc.dim(`  review drafts: ${pc.bold("skillset drafts")}`));
    console.log(pc.dim(`  promote:       ${pc.bold("skillset promote <name>")}`));
  }
}
