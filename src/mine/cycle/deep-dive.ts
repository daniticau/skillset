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

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import pc from "picocolors";
import { STORE_ROOT, SESSIONS_DIR } from "../../core/paths.js";
import { readState, writeState } from "../../core/config.js";
import { scrapeAll } from "../../ingest/sessions/index.js";
import {
  readAllSessions,
  extractSignal,
  defaultLLMConfig,
  isAvailable,
  detectEmbeddingModel,
} from "../index.js";
import type { LLMConfig, Nugget, NuggetCluster } from "../index.js";
import { llmExtractFromSessions } from "../llm-extract.js";
import { deduplicateAndRank } from "../dedup.js";
import {
  loadExistingSkillSummaries,
  planSkillAction,
  executeCreate,
} from "../make.js";
import { promoteDraft } from "../synthesize.js";
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

const NUGGETS_DIR = join(STORE_ROOT, "nuggets");
const NUGGETS_FILE = join(NUGGETS_DIR, "nuggets.json");
const CLUSTERS_FILE = join(NUGGETS_DIR, "clusters.json");

export interface DeepDiveOptions {
  /** Cap on new skills created in this run (default 10). */
  maxSkills?: number;
  /** Restart from scratch even if a checkpoint exists. */
  restart?: boolean;
  /** Dry-run — print plan without mutating anything. */
  dryRun?: boolean;
  /** Progress callback for stage transitions. */
  onStage?: (stage: string, detail?: string) => void;
}

async function saveNuggets(nuggets: Nugget[]): Promise<void> {
  await mkdir(NUGGETS_DIR, { recursive: true });
  await writeFile(NUGGETS_FILE, JSON.stringify(nuggets, null, 2) + "\n", "utf8");
}

async function saveClusters(clusters: NuggetCluster[]): Promise<void> {
  await mkdir(NUGGETS_DIR, { recursive: true });
  await writeFile(CLUSTERS_FILE, JSON.stringify(clusters, null, 2) + "\n", "utf8");
}

async function loadNuggets(): Promise<Nugget[]> {
  if (!existsSync(NUGGETS_FILE)) return [];
  try {
    const raw = await readFile(NUGGETS_FILE, "utf8");
    return JSON.parse(raw) as Nugget[];
  } catch {
    return [];
  }
}

async function loadClusters(): Promise<NuggetCluster[]> {
  if (!existsSync(CLUSTERS_FILE)) return [];
  try {
    const raw = await readFile(CLUSTERS_FILE, "utf8");
    return JSON.parse(raw) as NuggetCluster[];
  } catch {
    return [];
  }
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

    // Stage: heuristic-done
    const sessions = readAllSessions();
    let nuggets: Nugget[] = await loadNuggets();
    if (shouldRunStage(checkpoint.stage, "heuristic-done")) {
      onStage("extract-heuristic", `${sessions.length} sessions`);
      if (!options.dryRun) {
        const { nuggets: heuristic } = extractSignal(sessions);
        nuggets = heuristic;
        await saveNuggets(nuggets);
      }
      checkpoint = await advanceCheckpoint("heuristic-done", {
        sessionCount: sessions.length,
        nuggetCount: nuggets.length,
      });
    }

    // Stage: llm-done (optional — skipped if LLM unavailable)
    const llmConfig = defaultLLMConfig();
    const llmAvail = await isAvailable(llmConfig);
    if (shouldRunStage(checkpoint.stage, "llm-done")) {
      if (llmAvail.reachable && !options.dryRun) {
        onStage("extract-llm", `via ${llmConfig.provider}`);
        const { nuggets: llmNuggets } = await llmExtractFromSessions(
          sessions,
          nuggets,
          llmConfig
        );
        nuggets = [...nuggets, ...llmNuggets];
        await saveNuggets(nuggets);
      } else {
        onStage("extract-llm", `skipped (${llmAvail.reason ?? "LLM unavailable"})`);
      }
      checkpoint = await advanceCheckpoint("llm-done");
    }

    // Stage: clusters-done
    let clusters: NuggetCluster[] = await loadClusters();
    if (shouldRunStage(checkpoint.stage, "clusters-done")) {
      onStage("clustering", `${nuggets.length} nuggets`);
      if (!options.dryRun) {
        const clusterCfg = defaultLLMConfig();
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
        const topClusters = clusters
          .filter((c) => c.score >= 0.4)
          .sort((a, b) => b.score - a.score)
          .slice(0, maxSkills * 2); // consider 2x budget; triage may SKIP some

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
            await promoteDraft(skill.name);
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
