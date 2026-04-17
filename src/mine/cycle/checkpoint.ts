/**
 * Cycle checkpoint — resumable per-stage state for long-running workflows
 * (deep-dive, nightly cycle). Stored in state.currentCycle.
 *
 * Every stage in a cycle's state machine is idempotent when re-entered. After
 * a stage completes and its outputs are durable on disk, we advance the
 * checkpoint. If the process dies mid-stage, re-running sees the prior
 * completed stage and restarts this one from a clean input.
 */

import { randomUUID } from "node:crypto";
import { readState, writeState } from "../../core/config.js";
import type { CurrentCycle, CycleKind, CheckpointStage, State } from "../../core/config.js";

/** Stage ordering — each stage must be completed in this order. */
export const STAGE_ORDER: readonly CheckpointStage[] = [
  "init",
  "scraped",
  "heuristic-done",
  "llm-done",
  "clusters-done",
  "triaged",
  "synthesized",
  "committed",
  "complete",
];

export function stageIndex(stage: CheckpointStage): number {
  return STAGE_ORDER.indexOf(stage);
}

/**
 * Load the current cycle, if any. If the saved cycle's `kind` doesn't match
 * `expectedKind`, returns null (the caller should NOT resume a mismatched run).
 */
export async function loadCheckpoint(
  expectedKind: CycleKind
): Promise<CurrentCycle | null> {
  const state = await readState();
  const cur = state.currentCycle;
  if (!cur) return null;
  if (cur.kind !== expectedKind) return null;
  return cur;
}

/** Start a fresh cycle, overwriting any prior currentCycle. */
export async function startCheckpoint(
  kind: CycleKind,
  progress?: Record<string, unknown>
): Promise<CurrentCycle> {
  const cur: CurrentCycle = {
    id: randomUUID(),
    kind,
    startedAt: new Date().toISOString(),
    stage: "init",
    progress,
  };
  const state = await readState();
  state.currentCycle = cur;
  await writeState(state);
  return cur;
}

/** Advance the checkpoint to a new stage + optionally merge progress. */
export async function advanceCheckpoint(
  stage: CheckpointStage,
  progress?: Record<string, unknown>
): Promise<CurrentCycle> {
  const state = await readState();
  const cur = state.currentCycle;
  if (!cur) {
    throw new Error("advanceCheckpoint called with no currentCycle (start one first)");
  }
  const next: CurrentCycle = {
    ...cur,
    stage,
    progress: progress ? { ...(cur.progress ?? {}), ...progress } : cur.progress,
  };
  state.currentCycle = next;
  await writeState(state);
  return next;
}

/** Clear the checkpoint. Call when the cycle is fully done (success or abandonment). */
export async function clearCheckpoint(): Promise<void> {
  const state = await readState();
  delete state.currentCycle;
  await writeState(state);
}

/**
 * Helper: true if `target` stage is strictly ahead of `current`. Useful to
 * skip stages that a prior run already completed.
 */
export function shouldRunStage(
  current: CheckpointStage | undefined,
  target: CheckpointStage
): boolean {
  if (!current) return true;
  return stageIndex(target) > stageIndex(current);
}

/** Register process-level SIGINT / SIGBREAK handlers so interrupted runs leave
 *  the checkpoint behind (not cleared) — the next run resumes from the last
 *  completed stage. The caller supplies a cleanup function (e.g. flush state). */
export function registerInterruptHandlers(onInterrupt: () => Promise<void> | void): () => void {
  let handled = false;
  const handler = async () => {
    if (handled) return;
    handled = true;
    try {
      await onInterrupt();
    } catch {
      // ignore — we're already crashing
    }
    // Give any in-flight write a tick, then exit non-zero so schedulers retry.
    setImmediate(() => process.exit(130));
  };
  process.on("SIGINT", handler);
  // SIGBREAK only exists on Windows; guard so other platforms don't warn.
  if (process.platform === "win32") {
    process.on("SIGBREAK", handler);
  }
  return () => {
    process.off("SIGINT", handler);
    if (process.platform === "win32") {
      process.off("SIGBREAK", handler);
    }
  };
}

export type { State };
