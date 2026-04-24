/**
 * Nightly cycle — the daily self-improvement pass.
 *
 * Flow (invoked by `sks cycle --nightly` and by the scheduled task):
 *   acquireLock -> isIdle() gate -> scrape(incremental) -> mine+synthesize ->
 *   make (triage, budget=3) -> cleanup (stub in phase 3) -> sync ->
 *   stageAndCommitCycle -> recordReviewedToday -> releaseLock.
 *
 * If any stage fails the run bails cleanly: lock release, checkpoint left
 * behind for diagnostics, error surfaced to the caller. Scheduled task wrapper
 * treats lock-busy as a non-error (exit 0).
 */

import pc from "picocolors";
import { mkdir } from "node:fs/promises";
import {
  SESSIONS_DIR,
} from "../../core/paths.js";
import {
  readState,
  writeState,
  DEFAULT_CYCLE_CONFIG,
} from "../../core/config.js";
import type { CycleConfig } from "../../core/config.js";
import { scrapeAll } from "../../ingest/sessions/index.js";
import {
  readAllSessions,
  extractSignal,
  defaultLLMConfig,
  isAvailable,
  detectEmbeddingModel,
} from "../index.js";
import type { Nugget, NuggetCluster } from "../index.js";
import { llmExtractFromSessions } from "../llm-extract.js";
import { deduplicateAndRank } from "../dedup.js";
import { loadNuggets, saveClusters, saveNuggets } from "../artifacts.js";
import {
  loadExistingSkillSummaries,
  planSkillAction,
  executeCreate,
  executeEdit,
} from "../make.js";
import { promoteDraft } from "../synthesize.js";
import { sync } from "../../core/mirror.js";
import { stageAndCommitCycle } from "../../core/audit/git.js";
import type {
  CycleReport,
  CycleCreatedSkill,
  CycleEditedSkill,
  CycleMergedSkills,
  CyclePrunedSkill,
} from "../../core/audit/git.js";
import { runCleanup } from "../cleanup/index.js";
import {
  startCheckpoint,
  advanceCheckpoint,
  clearCheckpoint,
  loadCheckpoint,
  registerInterruptHandlers,
} from "./checkpoint.js";
import { acquireLock } from "./lock.js";
import { isIdle } from "./idle.js";
import { recordReviewedToday } from "./reviewed.js";

export interface NightlyOptions {
  /** Skip the idle gate (useful for manual runs or tests). */
  noIdleCheck?: boolean;
  /** Dry-run: no writes, no state mutations. */
  dryRun?: boolean;
  /** Progress callback. */
  onStage?: (stage: string, detail?: string) => void;
  /** Force the run even if the scheduled task's wrapper would bail. */
  force?: boolean;
}

export type NightlyOutcome =
  | { ran: true; report: CycleReport }
  | { ran: false; reason: string };

function resolveConfig(stateConfig: CycleConfig | undefined): CycleConfig {
  if (!stateConfig) return DEFAULT_CYCLE_CONFIG;
  return {
    ...DEFAULT_CYCLE_CONFIG,
    ...stateConfig,
    cycleDefaults: { ...DEFAULT_CYCLE_CONFIG.cycleDefaults, ...stateConfig.cycleDefaults },
    schedule: { ...DEFAULT_CYCLE_CONFIG.schedule, ...stateConfig.schedule },
    llm: { ...DEFAULT_CYCLE_CONFIG.llm, ...stateConfig.llm },
    cleanup: { ...DEFAULT_CYCLE_CONFIG.cleanup, ...stateConfig.cleanup },
  };
}

export async function runNightlyCycle(
  options: NightlyOptions = {}
): Promise<NightlyOutcome> {
  const onStage = options.onStage ?? (() => {});
  const start = Date.now();

  // 1. Acquire lock — bail gracefully if busy.
  const lockResult = await acquireLock("nightly");
  if (!lockResult.acquired) {
    onStage("lock-busy", lockResult.reason);
    return { ran: false, reason: lockResult.reason };
  }

  const unregisterSignals = registerInterruptHandlers(async () => {
    await lockResult.release();
  });

  try {
    // 2. Load config + idle gate
    const stateBefore = await readState();
    const cfg = resolveConfig(stateBefore.config);
    if (!options.noIdleCheck && !options.dryRun) {
      const idle = await isIdle({
        cpuPct: cfg.schedule.idleCpuPct,
        inactivityMin: cfg.schedule.idleInactivityMin,
      });
      if (!idle.idle) {
        onStage("idle-skip", idle.reason ?? "machine busy");
        return { ran: false, reason: idle.reason ?? "machine busy" };
      }
      onStage("idle-ok", idle.reason ?? "idle gate passed");
    }

    // 3. Checkpoint — fresh each night; we don't resume nightly cycles across
    //    days because the day's data bucket changes.
    const existingCheckpoint = await loadCheckpoint("nightly");
    if (existingCheckpoint && !options.force) {
      onStage("stale-checkpoint", `clearing stale ${existingCheckpoint.stage}`);
    }
    const cp = await startCheckpoint("nightly");

    // 4. Scrape (incremental)
    onStage("scrape", "incremental");
    if (!options.dryRun) {
      await mkdir(SESSIONS_DIR, { recursive: true });
      const state = await readState();
      const { nextCursors } = await scrapeAll(SESSIONS_DIR, state.scrape ?? {}, {});
      const s2 = await readState();
      s2.scrape = nextCursors;
      await writeState(s2);
    }
    await advanceCheckpoint("scraped");

    // 5. Mine (heuristic + LLM if available)
    const sessions = readAllSessions();
    onStage("mine", `${sessions.length} sessions`);
    let nuggets: Nugget[] = await loadNuggets();
    if (!options.dryRun && sessions.length > 0) {
      const { nuggets: heuristic } = extractSignal(sessions);
      nuggets = heuristic;
      await saveNuggets(nuggets);
    }
    await advanceCheckpoint("heuristic-done");

    const llmConfig = defaultLLMConfig();
    const llmAvail = await isAvailable(llmConfig);
    if (llmAvail.reachable && sessions.length > 0 && !options.dryRun) {
      onStage("mine-llm", `via ${llmConfig.provider}`);
      const { nuggets: llmNuggets } = await llmExtractFromSessions(
        sessions,
        nuggets,
        llmConfig
      );
      nuggets = [...nuggets, ...llmNuggets];
      await saveNuggets(nuggets);
    } else if (!llmAvail.reachable) {
      onStage("mine-llm-skip", llmAvail.reason ?? "LLM unreachable");
    }
    await advanceCheckpoint("llm-done");

    // 6. Cluster + rank
    let clusters: NuggetCluster[] = [];
    if (nuggets.length > 0 && !options.dryRun) {
      const clusterCfg = defaultLLMConfig();
      const embed = await detectEmbeddingModel(clusterCfg).catch(() => undefined);
      if (embed) clusterCfg.embeddingModel = embed;
      clusters = await deduplicateAndRank(nuggets, {
        useEmbeddings: !!embed,
        llmConfig: clusterCfg,
      });
      await saveClusters(clusters);
    }
    onStage("cluster", `${clusters.length} clusters`);
    await advanceCheckpoint("clusters-done");

    // 7. Triage + synthesize (capped budget)
    const created: CycleCreatedSkill[] = [];
    const edited: CycleEditedSkill[] = [];
    if (clusters.length > 0 && llmAvail.reachable && !options.dryRun) {
      const summaries = await loadExistingSkillSummaries();
      // origin=user-created skills are OFF-LIMITS for automation. Filter them
      // from the triage target set so executeEdit never fires on them.
      const state = await readState();
      const protectedNames = new Set(
        Object.entries(state.skills)
          .filter(([, s]) => s.origin === "user-created")
          .map(([name]) => name)
      );
      const eligibleSummaries = summaries.filter(
        (s) => !protectedNames.has(s.name)
      );

      const newCap = cfg.cycleDefaults.newCap;
      let budget = newCap;
      const topClusters = clusters
        .filter((c) => c.score >= 0.5)
        .sort((a, b) => b.score - a.score)
        .slice(0, newCap * 2);

      for (const cluster of topClusters) {
        if (budget <= 0) break;
        try {
          const action = await planSkillAction(
            cluster,
            eligibleSummaries,
            llmConfig,
            budget
          );
          if (action.kind === "skip") continue;
          if (action.kind === "edit") {
            // Double-check the target isn't user-created (shouldn't happen since
            // we filtered summaries, but belt + suspenders).
            if (protectedNames.has(action.targetName)) {
              onStage("skip-user-created", action.targetName);
              continue;
            }
            await executeEdit(action.targetName, cluster, llmConfig);
            edited.push({ name: action.targetName, rationale: action.rationale });
            onStage("edited", action.targetName);
            continue;
          }
          if (action.kind === "create") {
            const { skill } = await executeCreate(action, cluster, llmConfig);
            await promoteDraft(skill.name);
            created.push({ name: skill.name, description: skill.description });
            eligibleSummaries.push({ name: skill.name, description: skill.description });
            budget -= 1;
            onStage("created", skill.name);
          }
        } catch (err) {
          onStage("triage-error", err instanceof Error ? err.message : String(err));
        }
      }
    }
    await advanceCheckpoint("synthesized");

    // 8. Cleanup pass — conflict detection + dedup merge + dry-run prune.
    //    origin=user-created skills are excluded inside runCleanup.
    const merged: CycleMergedSkills[] = [];
    const pruned: CyclePrunedSkill[] = [];
    if (!options.dryRun && llmAvail.reachable) {
      onStage("cleanup", "conflict + dedup + prune");
      const cleanup = await runCleanup({
        llmConfig,
        mergeCap: cfg.cycleDefaults.mergeCap,
        pruneEnabled: cfg.cleanup.pruneEnabled,
        pruneCap: cfg.cycleDefaults.pruneCap,
        onEvent: (evt, detail) => onStage(evt, detail),
      });
      // Conflicts become "merges" semantically for the audit report (2 in, 1 out).
      for (const c of cleanup.conflictsResolved) {
        merged.push({ from: [c.winner, c.loser], into: c.winner });
      }
      for (const m of cleanup.merges) {
        merged.push({ from: m.replaced, into: m.produced });
      }
      for (const p of cleanup.prunedCandidates) {
        pruned.push({ name: p.name, reason: p.reason });
      }
    } else {
      onStage("cleanup", "skipped (dry-run or LLM unavailable)");
    }
    await advanceCheckpoint("triaged"); // stage name retained for ordering

    // 9. Sync + commit
    if (!options.dryRun) {
      onStage("sync", "pushing to mirrors");
      await sync();
      const report: CycleReport = {
        kind: "nightly",
        cycleId: cp.id,
        durationMs: Date.now() - start,
        llmProvider: llmConfig.provider,
        createdSkills: created,
        editedSkills: edited,
        mergedSkills: merged,
        prunedSkills: pruned,
      };
      const commit = await stageAndCommitCycle(report);
      if (commit) onStage("committed", commit.sha.slice(0, 8));
      await advanceCheckpoint("committed");

      // 10. Record today's rollup
      await recordReviewedToday({
        skillsProduced: created.length,
        skillsMerged: merged.length,
        skillsPruned: pruned.length,
      });
    }

    await clearCheckpoint();
    onStage("complete");

    const report: CycleReport = {
      kind: "nightly",
      cycleId: cp.id,
      durationMs: Date.now() - start,
      llmProvider: llmConfig.provider,
      createdSkills: created,
      editedSkills: edited,
      mergedSkills: merged,
      prunedSkills: pruned,
    };
    return { ran: true, report };
  } finally {
    unregisterSignals();
    await lockResult.release();
  }
}

export function consoleNightlyLogger(stage: string, detail?: string): void {
  const icon =
    stage === "complete"
      ? pc.green("✓")
      : stage === "lock-busy" || stage === "idle-skip"
        ? pc.yellow("•")
        : stage.endsWith("-error")
          ? pc.red("✗")
          : pc.dim("›");
  const detailStr = detail ? pc.dim(` ${detail}`) : "";
  console.log(`  ${icon} ${stage}${detailStr}`);
}
