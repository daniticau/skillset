/**
 * Deep-dive — one-shot onboarding pass that ingests ALL coding-agent history
 * on disk and synthesizes up to N foundational skills. Resumable via the
 * checkpoint module.
 *
 * Stage machine (each stage idempotent):
 *   init -> scraped -> heuristic-done -> llm-done -> clusters-done ->
 *   triaged -> synthesized -> committed -> complete
 *
 * If interrupted, re-run picks up from the last committed stage.
 */

import { mkdir } from "node:fs/promises";
import { statSync } from "node:fs";
import pc from "picocolors";
import { SESSIONS_DIR } from "../../core/paths.js";
import { readState, writeState } from "../../core/config.js";
import { scrapeAll } from "../../ingest/sessions/index.js";
import {
  readAllSessions,
  extractSignal,
  defaultLLMConfig,
  isAvailable,
  detectEmbeddingModel,
  ollamaEmbeddingConfig,
} from "../index.js";
import type { Nugget, NuggetCluster, ParsedSession } from "../index.js";
import { deduplicateAndRank } from "../dedup.js";
import { loadClusters, loadNuggets, saveClusters, saveNuggets } from "../artifacts.js";
import {
  loadExistingSkillSummaries,
  planSkillAction,
  executeCreate,
} from "../make.js";
import { balancedClusterOrder, focusForCluster, isPrimaryFocus } from "../focus.js";
import { sync } from "../../core/mirror.js";
import { stageAndCommitCycle } from "../../core/audit/git.js";
import type { CycleReport, CycleCreatedSkill } from "../../core/audit/git.js";
import {
  startCheckpoint,
  loadCheckpoint,
  advanceCheckpoint,
  clearCheckpoint,
  registerInterruptHandlers,
  shouldRunStage,
} from "./checkpoint.js";

/**
 * Max sessions fed into heuristic extraction. Users often have 500–1000
 * sessions on disk; for a FAST foundational pass we want the most recent
 * window only. Nightly cycles pick up everything else over time.
 */
const DEEP_DIVE_SESSION_CAP = 300;

export interface DeepDiveOptions {
  /** Cap on new skills created in this run (default 10). */
  maxSkills?: number;
  /** Cap on sessions to process (default 300 most-recent). */
  maxSessions?: number;
  /** Restart from scratch even if a checkpoint exists. */
  restart?: boolean;
  /** Dry-run — print plan without mutating anything. */
  dryRun?: boolean;
  /** Progress callback for stage transitions. */
  onStage?: (stage: string, detail?: string) => void;
}

/**
 * Return only the most-recent N sessions by file mtime. Sessions without a
 * readable mtime go to the end. Sorted descending (newest first).
 */
function sampleRecent(sessions: ParsedSession[], cap: number): ParsedSession[] {
  if (sessions.length <= cap) return sessions;
  const scored = sessions.map((s) => {
    let mtime = 0;
    try {
      mtime = statSync(s.filePath).mtimeMs;
    } catch {
      mtime = 0;
    }
    return { session: s, mtime };
  });
  scored.sort((a, b) => b.mtime - a.mtime);
  return scored.slice(0, cap).map((x) => x.session);
}

/** Temporarily zero out scrape cursors so scrapeAll rescans everything. */
async function stashScrapeCursors(): Promise<void> {
  const state = await readState();
  if (state.scrape) {
    state.scrape = { ...state.scrape, __deepDiveStashed: true } as typeof state.scrape;
  }
  await writeState(state);
}

export async function runDeepDive(
  options: DeepDiveOptions = {}
): Promise<CycleReport> {
  const maxSkills = options.maxSkills ?? 10;
  const maxSessions = options.maxSessions ?? DEEP_DIVE_SESSION_CAP;
  const onStage = options.onStage ?? (() => {});
  const startTime = Date.now();

  // Checkpoint handling
  let checkpoint = options.restart ? null : await loadCheckpoint("deep-dive");
  if (!checkpoint) {
    checkpoint = await startCheckpoint("deep-dive", { maxSkills });
    onStage("init", "fresh cycle");
  } else {
    onStage("init", `resuming from ${checkpoint.stage}`);
  }

  const unregister = registerInterruptHandlers(async () => {
    // Nothing extra — state.json was written after the last stage advance.
  });

  try {
    const created: CycleCreatedSkill[] = [];

    // Stage: scraped — ingest ALL history
    if (shouldRunStage(checkpoint.stage, "scraped")) {
      onStage("scraping", "ingesting all history");
      if (!options.dryRun) {
        await stashScrapeCursors();
        await mkdir(SESSIONS_DIR, { recursive: true });
        const state = await readState();
        await scrapeAll(SESSIONS_DIR, state.scrape ?? {}, { full: true });
      }
      checkpoint = await advanceCheckpoint("scraped");
    }

    // Stage: heuristic-done — sample most-recent sessions for a fast pass.
    // Nightly cycles pick up older + LLM-validated signal over time, so this
    // deep-dive pass is designed to complete in 5–10 minutes on a typical
    // machine regardless of total history size.
    const allSessions = readAllSessions();
    const sessions = sampleRecent(allSessions, maxSessions);
    let nuggets: Nugget[] = await loadNuggets();
    if (shouldRunStage(checkpoint.stage, "heuristic-done")) {
      onStage(
        "extract-heuristic",
        `${sessions.length}/${allSessions.length} sessions (recent-first)`
      );
      if (!options.dryRun) {
        const { nuggets: heuristic } = extractSignal(sessions);
        nuggets = heuristic;
        await saveNuggets(nuggets);
      }
      checkpoint = await advanceCheckpoint("heuristic-done", {
        sessionCount: sessions.length,
        totalSessions: allSessions.length,
        nuggetCount: nuggets.length,
      });
    }

    // Stage: llm-done — INTENTIONALLY NO-OP on deep-dive.
    // Full LLM extraction across every session × every window takes hours on
    // a CLI-backed subscription; it's deferred to nightly cycles where the
    // per-night incremental cost is small. The stage name is kept in the
    // checkpoint sequence so existing checkpoints from prior versions resume
    // cleanly (they'll just advance past this no-op).
    const llmConfig = defaultLLMConfig();
    const llmAvail = await isAvailable(llmConfig);
    if (shouldRunStage(checkpoint.stage, "llm-done")) {
      onStage(
        "extract-llm",
        "skipped — nightly cycles handle deep LLM extraction"
      );
      checkpoint = await advanceCheckpoint("llm-done");
    }

    // Stage: clusters-done
    let clusters: NuggetCluster[] = await loadClusters();
    if (shouldRunStage(checkpoint.stage, "clusters-done")) {
      onStage("clustering", `${nuggets.length} nuggets`);
      if (!options.dryRun) {
        const clusterCfg = ollamaEmbeddingConfig(defaultLLMConfig());
        const embedModel = await detectEmbeddingModel(clusterCfg).catch(() => undefined);
        if (embedModel) clusterCfg.embeddingModel = embedModel;
        clusters = await deduplicateAndRank(nuggets, {
          useEmbeddings: !!embedModel,
          llmConfig: clusterCfg,
        });
        await saveClusters(clusters);
      }
      checkpoint = await advanceCheckpoint("clusters-done", {
        clusterCount: clusters.length,
      });
    }

    // Stage: triaged + synthesized — triage top N clusters and create skills
    if (shouldRunStage(checkpoint.stage, "synthesized")) {
      if (clusters.length === 0) {
        onStage("synthesize", "no clusters to synthesize");
      } else if (!llmAvail.reachable) {
        onStage("synthesize", `skipped (LLM unavailable: ${llmAvail.reason ?? "?"})`);
      } else {
        onStage("synthesize", `up to ${maxSkills} skills`);
        const summaries = await loadExistingSkillSummaries();
        const topClusters = balancedClusterOrder(
          clusters
            .filter((c) => c.score >= 0.4)
            .filter((c) => isPrimaryFocus(focusForCluster(c)))
            .sort((a, b) => b.score - a.score)
            // Consider ~1.5x budget so triage can SKIP some noisy ones. Keeping
            // this tight matters: each considered cluster costs a serialized
            // claude-cli triage call (~10–20s on subscription CLIs).
            .slice(0, Math.ceil(maxSkills * 1.5)),
          maxSkills
        );

        let budget = maxSkills;
        for (const cluster of topClusters) {
          if (budget <= 0) break;
          if (options.dryRun) {
            created.push({ name: `(dry-run) cluster ${cluster.id}`, description: cluster.canonical.signal });
            budget -= 1;
            continue;
          }
          try {
            const action = await planSkillAction(cluster, summaries, llmConfig, budget);
            if (action.kind !== "create") continue;
            const { skill } = await executeCreate(action, cluster, llmConfig);
            created.push({ name: skill.name, description: skill.description });
            summaries.push({ name: skill.name, description: skill.description });
            budget -= 1;
            onStage("created", skill.name);
          } catch (err) {
            onStage("create-error", err instanceof Error ? err.message : String(err));
          }
        }
      }
      checkpoint = await advanceCheckpoint("synthesized", {
        createdCount: created.length,
      });
    }

    // Stage: committed — sync + git commit
    if (shouldRunStage(checkpoint.stage, "committed")) {
      if (!options.dryRun) {
        onStage("sync", "pushing to mirrors");
        await sync();
        const report: CycleReport = {
          kind: "deep-dive",
          cycleId: checkpoint.id,
          durationMs: Date.now() - startTime,
          llmProvider: llmConfig.provider,
          createdSkills: created,
          editedSkills: [],
          mergedSkills: [],
          prunedSkills: [],
        };
        const commit = await stageAndCommitCycle(report);
        if (commit) onStage("committed", commit.sha.slice(0, 8));
      }
      checkpoint = await advanceCheckpoint("committed");
    }

    // Stage: complete — clear checkpoint
    if (!options.dryRun) {
      await clearCheckpoint();
    }
    onStage("complete");

    return {
      kind: "deep-dive",
      cycleId: checkpoint.id,
      durationMs: Date.now() - startTime,
      llmProvider: llmConfig.provider,
      createdSkills: created,
      editedSkills: [],
      mergedSkills: [],
      prunedSkills: [],
    };
  } finally {
    unregister();
  }
}

/** Log progress to stdout with consistent formatting. Used by the CLI wrapper. */
export function consoleStageLogger(stage: string, detail?: string): void {
  const icon =
    stage === "complete" ? pc.green("✓") : stage.endsWith("-error") ? pc.red("✗") : pc.dim("›");
  const detailStr = detail ? pc.dim(` ${detail}`) : "";
  console.log(`  ${icon} ${stage}${detailStr}`);
}
