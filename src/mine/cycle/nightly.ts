/**
 * Nightly cycle — the daily self-improvement pass.
 *
 * Flow (invoked by `sks dream --run-now` and the macOS LaunchAgent):
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
  ollamaEmbeddingConfig,
} from "../index.js";
import type { Nugget, NuggetCluster } from "../index.js";
import { llmExtractFromSessions } from "../llm-extract.js";
import { deduplicateAndRank } from "../dedup.js";
import { loadClusters, loadNuggets, saveClusters, saveNuggets } from "../artifacts.js";
import { mergeNuggets } from "../nuggets.js";
import {
  finalizeRun,
  markManyProcessed,
  needsProcessing,
  readMineState,
  sessionFileHash,
  writeMineState,
} from "../state.js";
import {
  loadExistingSkillSummaries,
  planSkillAction,
  executeCreate,
  executeEdit,
} from "../make.js";
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
  balancedClusterOrder,
  cappedFocusCandidates,
  focusCounts,
  focusForCluster,
  isPrimaryFocus,
} from "../focus.js";
import {
  startCheckpoint,
  advanceCheckpoint,
  clearCheckpoint,
  loadCheckpoint,
  registerInterruptHandlers,
} from "./checkpoint.js";
import { acquireLock } from "./lock.js";
import { isIdle } from "./idle.js";
import {
  hasCompletedReviewToday,
  markReviewSkipped,
  markReviewStarted,
  recordReviewedToday,
} from "./reviewed.js";

export interface NightlyOptions {
  /** Skip the idle gate (useful for manual runs or tests). */
  noIdleCheck?: boolean;
  /** Dry-run: no writes, no state mutations. */
  dryRun?: boolean;
  /** Progress callback. */
  onStage?: (stage: string, detail?: string) => void;
  /** Force the run even if today's review already completed. */
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
  let activeCycleId: string | undefined;

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
    if (!options.force && !options.dryRun && (await hasCompletedReviewToday())) {
      onStage("already-reviewed", "today is already completed");
      return { ran: false, reason: "today is already completed" };
    }
    if (!options.noIdleCheck && !options.dryRun) {
      const idle = await isIdle({
        cpuPct: cfg.schedule.idleCpuPct,
        inactivityMin: cfg.schedule.idleInactivityMin,
      });
      if (!idle.idle) {
        onStage("idle-skip", idle.reason ?? "machine busy");
        await markReviewSkipped(idle.reason ?? "machine busy");
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
    activeCycleId = cp.id;
    if (!options.dryRun) {
      await markReviewStarted({ cycleId: cp.id });
    }

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

    // 5. Mine new/changed sessions only (heuristic + LLM if available)
    const llmConfig = defaultLLMConfig();
    const llmAvail = await isAvailable(llmConfig);
    const sessions = readAllSessions();
    let mineState = await readMineState();
    const targetStage = llmAvail.reachable ? "llm-validated" : "heuristic";
    const sessionKey = (s: { source?: string; sessionId: string }) =>
      `${s.source ?? "unknown"}:${s.sessionId}`;
    const sessionsToProcess = options.force
      ? sessions
      : sessions.filter((session) => {
          const hash = session.fileHash ?? sessionFileHash(session.filePath);
          if (!hash) return true;
          return needsProcessing(sessionKey(session), hash, mineState, targetStage);
        });

    onStage("mine", `${sessionsToProcess.length}/${sessions.length} sessions`);
    let nuggets: Nugget[] = options.force ? [] : await loadNuggets();
    if (!options.dryRun && sessionsToProcess.length > 0) {
      const { nuggets: heuristic } = extractSignal(sessionsToProcess);
      let incoming = [...heuristic];
      nuggets = mergeNuggets(nuggets, incoming);
      await saveNuggets(nuggets);
      onStage("heuristic", `${heuristic.length} nuggets`);
    } else if (sessionsToProcess.length === 0) {
      onStage("mine-skip", `all sessions processed at ${targetStage}`);
    }
    await advanceCheckpoint("heuristic-done");

    if (llmAvail.reachable && sessionsToProcess.length > 0 && !options.dryRun) {
      onStage("mine-llm", `via ${llmConfig.provider}`);
      const { nuggets: llmNuggets } = await llmExtractFromSessions(
        sessionsToProcess,
        nuggets,
        llmConfig
      );
      nuggets = mergeNuggets(nuggets, llmNuggets);
      await saveNuggets(nuggets);
      onStage("llm-nuggets", `${llmNuggets.length}`);
    } else if (!llmAvail.reachable) {
      onStage("mine-llm-skip", llmAvail.reason ?? "LLM unreachable");
    }
    await advanceCheckpoint("llm-done");

    if (!options.dryRun && sessionsToProcess.length > 0) {
      mineState = markManyProcessed(
        mineState,
        sessionsToProcess
          .map((session) => ({
            sessionId: sessionKey(session),
            fileHash: session.fileHash ?? sessionFileHash(session.filePath),
          }))
          .filter((e) => e.fileHash),
        targetStage
      );
      await writeMineState(finalizeRun(mineState));
    }

    // 6. Cluster + rank
    let clusters: NuggetCluster[] = await loadClusters();
    if (
      nuggets.length > 0 &&
      !options.dryRun &&
      (sessionsToProcess.length > 0 || clusters.length === 0)
    ) {
      const clusterCfg = ollamaEmbeddingConfig(defaultLLMConfig());
      const embed = await detectEmbeddingModel(clusterCfg).catch(() => undefined);
      if (embed) clusterCfg.embeddingModel = embed;
      clusters = await deduplicateAndRank(nuggets, {
        useEmbeddings: !!embed,
        llmConfig: clusterCfg,
      });
      await saveClusters(clusters);
    }
    onStage("cluster", `${clusters.length} clusters`);
    const counts = focusCounts(clusters);
    await advanceCheckpoint("clusters-done");

    // 7. Triage + synthesize (capped budget)
    const created: CycleCreatedSkill[] = [];
    const edited: CycleEditedSkill[] = [];
    if (clusters.length > 0 && sessionsToProcess.length > 0 && llmAvail.reachable && !options.dryRun) {
      const summaries = await loadExistingSkillSummaries();
      // origin=user-created skills are OFF-LIMITS for automation. Filter them
      // from the triage target set so executeEdit never fires on them.
      const state = await readState();
      const protectedNames = new Set(
        Object.entries(state.skills)
          .filter(([, s]) => s.origin === "user-created" || s.userEdited)
          .map(([name]) => name)
      );
      const newCap = cfg.cycleDefaults.newCap;
      let budget = newCap;
      const topClusters = balancedClusterOrder(
        cappedFocusCandidates(
          clusters
            .filter((c) => c.score >= 0.5)
            .filter((c) => isPrimaryFocus(focusForCluster(c))),
          {
            mistakeCap: cfg.cycleDefaults.mistakeCap,
            preferenceCap: cfg.cycleDefaults.preferenceCap,
            fillCap: newCap * 2,
          }
        ).slice(0, newCap * 2),
        newCap
      );
      const handledClusterIds = new Set<string>();

      for (const cluster of topClusters) {
        if (budget <= 0) break;
        try {
          const action = await planSkillAction(
            cluster,
            summaries,
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
            handledClusterIds.add(cluster.id);
            onStage("edited", action.targetName);
            continue;
          }
          if (action.kind === "create") {
            const { skill } = await executeCreate(action, cluster, llmConfig);
            created.push({ name: skill.name, description: skill.description });
            summaries.push({ name: skill.name, description: skill.description });
            handledClusterIds.add(cluster.id);
            budget -= 1;
            onStage("created", skill.name);
          }
        } catch (err) {
          onStage("triage-error", err instanceof Error ? err.message : String(err));
        }
      }

      const tuningCandidates = topClusters
        .filter((cluster) => !handledClusterIds.has(cluster.id))
        .slice(0, Math.max(5, created.length + edited.length + 3));
      for (const cluster of tuningCandidates) {
        try {
          const action = await planSkillAction(
            cluster,
            summaries,
            llmConfig,
            0
          );
          if (action.kind !== "edit") continue;
          if (protectedNames.has(action.targetName)) continue;
          await executeEdit(action.targetName, cluster, llmConfig);
          edited.push({ name: action.targetName, rationale: action.rationale });
          onStage("tuned", action.targetName);
        } catch (err) {
          onStage("tune-error", err instanceof Error ? err.message : String(err));
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
        dryRun: false,
        pruneEnabled: cfg.cleanup.pruneEnabled,
        pruneCap: cfg.cycleDefaults.pruneCap,
        onEvent: (evt, detail) => onStage(evt, detail),
      });
      for (const c of cleanup.coveredByUser) {
        merged.push({ from: [c.redundant], into: c.coveredBy });
      }
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
        status: "completed",
        cycleId: cp.id,
        sessionsReviewed: sessionsToProcess.length,
        mistakeClusters: counts["agent-mistake"],
        preferenceClusters: counts["user-preference"],
        skillsCreated: created.length,
        skillsEdited: edited.length,
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
  } catch (err) {
    if (!options.dryRun) {
      await recordReviewedToday({
        status: "failed",
        cycleId: activeCycleId,
        skipReason: err instanceof Error ? err.message : String(err),
      });
    }
    throw err;
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
