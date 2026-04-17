/**
 * Cleanup orchestrator — runs at the tail of every nightly cycle (phase 3).
 *
 * Order:
 *   1. Conflict detection — pairwise LLM adjudication; most-recent wins.
 *   2. Dedup merge — semantic near-duplicates collapsed into one.
 *   3. Prune — stale/low-value candidates (DRY-RUN only in v1).
 *
 * Hard invariant: skills with origin="user-created" are NEVER modified.
 * They may appear in findings (for reporting) but no state change ever
 * touches them. The caller trusts that invariant to keep user work safe.
 */

import { readState } from "../../core/config.js";
import type { LLMConfig } from "../llm/index.js";
import { runConflictDetection } from "./conflict-detect.js";
import type { ConflictOutcome } from "./conflict-detect.js";
import { runDedupMerge } from "./dedup-merge.js";
import type { MergeOutcome } from "./dedup-merge.js";
import { runPrune } from "./prune.js";
import type { PruneOutcome } from "./prune.js";

export interface CleanupOptions {
  llmConfig: LLMConfig;
  mergeCap: number;
  pruneEnabled: boolean;
  pruneCap: number;
  /** Progress callback. */
  onEvent?: (event: string, detail?: string) => void;
}

export interface CleanupReport {
  conflictsResolved: ConflictOutcome[];
  merges: MergeOutcome[];
  prunedCandidates: PruneOutcome[];
}

/**
 * Enumerate skills eligible for cleanup: everything origin!="user-created".
 * Shared helper so each pass agrees on the candidate set.
 */
export async function eligibleSkills(): Promise<string[]> {
  const state = await readState();
  const out: string[] = [];
  for (const [name, s] of Object.entries(state.skills)) {
    if (s.origin === "user-created") continue;
    out.push(name);
  }
  return out.sort();
}

export async function runCleanup(options: CleanupOptions): Promise<CleanupReport> {
  const onEvent = options.onEvent ?? (() => {});
  const candidates = await eligibleSkills();
  onEvent("cleanup-start", `${candidates.length} auto-created skills in scope`);

  const conflicts = await runConflictDetection(candidates, options.llmConfig, onEvent);
  onEvent("conflict-done", `${conflicts.length} conflict(s) resolved`);

  const remaining = candidates.filter(
    (name) => !conflicts.some((c) => c.loser === name)
  );
  const merges = await runDedupMerge(
    remaining,
    options.llmConfig,
    options.mergeCap,
    onEvent
  );
  onEvent("merge-done", `${merges.length} merge(s)`);

  const afterMerge = remaining.filter(
    (name) => !merges.some((m) => m.replaced.includes(name))
  );
  const prunedCandidates = await runPrune(afterMerge, {
    enabled: options.pruneEnabled,
    cap: options.pruneCap,
    onEvent,
  });
  onEvent("prune-done", `${prunedCandidates.length} candidate(s)`);

  return {
    conflictsResolved: conflicts,
    merges,
    prunedCandidates,
  };
}
