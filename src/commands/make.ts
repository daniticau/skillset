import pc from "picocolors";
import { existsSync } from "node:fs";
import { defaultLLMConfig, isAvailable } from "../mine/llm/index.js";
import type { NuggetCluster } from "../mine/types.js";
import {
  readMakeState,
  writeMakeState,
  needsMaking,
  recordAction,
  invalidateDeletedTargets,
  finalizeMakeRun,
} from "../mine/make-state.js";
import {
  loadExistingSkillSummaries,
  planSkillAction,
  executeEdit,
  executeCreate,
} from "../mine/make.js";
import { CLUSTERS_FILE, readClusters } from "../mine/artifacts.js";
import { syncCommand } from "./sync.js";
import { readState } from "../core/config.js";
import { balancedClusterOrder, focusForCluster, isPrimaryFocus } from "../mine/focus.js";

export interface MakeCmdOptions {
  maxNew?: number;
  minScore?: number;
  limit?: number;
  dryRun?: boolean;
  force?: boolean;
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
    clusters = await readClusters();
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
  const globalState = await readState();
  const protectedNames = new Set(
    Object.entries(globalState.skills)
      .filter(([, s]) => s.origin === "user-created" || s.userEdited)
      .map(([name]) => name)
  );

  const minScore = options.minScore ?? 0.5;
  const maxLimit = options.limit ?? 20;
  let eligible = clusters
    .filter((c) => c.score >= minScore)
    .filter((c) => isPrimaryFocus(focusForCluster(c)))
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

  let editedCount = 0;
  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;
  let skippedCount = 0;

  const maxNew = options.maxNew ?? 3;
  const ordered = balancedClusterOrder(eligible, maxNew);
  const handledClusterIds = new Set<string>();

  for (const cluster of ordered) {
    const budget = maxNew - (highCount + mediumCount + lowCount);
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
      if (protectedNames.has(action.targetName)) {
        console.log(`  ${pc.dim("SKIP  ")} ${scoreTag} ${pc.dim(sig)}`);
        console.log(`         ${pc.dim(`target "${action.targetName}" is user-created`)}`);
        skippedCount += 1;
        if (!options.dryRun) {
          state = recordAction(state, cluster, "skip", {
            reason: `target "${action.targetName}" is user-created`,
          });
        }
        continue;
      }
      const tag = `${pc.cyan("EDIT  ")} ${scoreTag}`;
      console.log(`  ${tag} ${pc.bold(action.targetName)} ← ${pc.dim(sig)}`);
      if (action.rationale) console.log(`         ${pc.dim(action.rationale)}`);
      if (options.dryRun) continue;
      try {
        const { path } = await executeEdit(action.targetName, cluster, config);
        console.log(`         ${pc.dim(`→ ${path}`)}`);
        editedCount += 1;
        handledClusterIds.add(cluster.id);
        state = recordAction(state, cluster, "edit", { targetSkill: action.targetName });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`         ${pc.red(`edit failed: ${msg}`)}`);
        skippedCount += 1;
        state = recordAction(state, cluster, "skip", { reason: `edit execution failed: ${msg}` });
      }
      continue;
    }

    // create — every tier installs directly into canonical; tier is still
    // retained so future cleanup/tailoring can reason about confidence.
    const tierColor =
      action.tier === "high" ? pc.green : action.tier === "medium" ? pc.cyan : pc.yellow;
    const tierTag = tierColor(`(${action.tier})`);
    console.log(
      `  ${pc.green("CREATE")} ${scoreTag} ${tierTag} ${pc.bold(action.name)}  ${pc.dim(sig)}`
    );
    if (action.rationale) console.log(`         ${pc.dim(action.rationale)}`);
    if (options.dryRun) continue;
    try {
      const { path, skill } = await executeCreate(action, cluster, config);
      if (action.tier === "medium") {
        console.log(`         ${pc.dim(`→ ${path}`)} ${pc.cyan("(installed, medium tier)")}`);
        mediumCount += 1;
      } else if (action.tier === "low") {
        console.log(`         ${pc.dim(`→ ${path}`)} ${pc.yellow("(installed, low tier)")}`);
        lowCount += 1;
      } else {
        console.log(`         ${pc.dim(`→ ${path}`)}`);
        highCount += 1;
      }
      handledClusterIds.add(cluster.id);
      state = recordAction(state, cluster, "create", { targetSkill: skill.name });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`         ${pc.red(`create failed: ${msg}`)}`);
      skippedCount += 1;
      state = recordAction(state, cluster, "skip", { reason: `create execution failed: ${msg}` });
    }
  }

  if (!options.dryRun && summaries.length > 0) {
    const createdCount = highCount + mediumCount + lowCount;
    const tuningCandidates = eligible
      .filter((cluster) => cluster.score >= minScore)
      .filter((cluster) => !handledClusterIds.has(cluster.id))
      .slice(0, Math.max(5, createdCount + editedCount + 3));

    for (const cluster of tuningCandidates) {
      const sig = truncate(cluster.canonical.signal, 90);
      const scoreTag = pc.dim(`[score ${cluster.score.toFixed(2)}]`);
      let action;
      try {
        action = await planSkillAction(cluster, summaries, config, 0);
      } catch {
        continue;
      }
      if (action.kind !== "edit") continue;
      if (protectedNames.has(action.targetName)) continue;
      console.log(`  ${pc.cyan("TUNE  ")} ${scoreTag} ${pc.bold(action.targetName)} ← ${pc.dim(sig)}`);
      try {
        const { path } = await executeEdit(action.targetName, cluster, config);
        console.log(`         ${pc.dim(`→ ${path}`)}`);
        editedCount += 1;
        handledClusterIds.add(cluster.id);
        state = recordAction(state, cluster, "edit", { targetSkill: action.targetName });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`         ${pc.red(`tune failed: ${msg}`)}`);
      }
    }
  }

  if (!options.dryRun) {
    state = finalizeMakeRun(state);
    await writeMakeState(state);
  }

  console.log();
  console.log(
    pc.bold(
      `${editedCount} edited · ${highCount} high-installed · ${mediumCount} medium-installed · ${lowCount} low-installed · ${skippedCount} skipped`
    )
  );

  const installedCount = highCount + mediumCount + lowCount;
  const shouldSync = !options.dryRun && (editedCount > 0 || installedCount > 0);
  if (shouldSync) {
    console.log();
    console.log(pc.dim("syncing mirrors…"));
    await syncCommand();
  }
}
