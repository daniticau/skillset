/**
 * Per-cluster processing state for `sks make`.
 *
 * `clusterFingerprint` is stable across cluster re-ranks: it hashes the sorted
 * nugget IDs of the cluster's members, so a cluster that gets the same input
 * signals gets the same fingerprint regardless of score order.
 *
 * Skip decisions are re-considered after 30 days (a pattern that was noise
 * last month might have real evidence this month). Edit/create entries persist
 * until the target skill is deleted.
 */

import { createHash } from "node:crypto";
import type { NuggetCluster } from "./types.js";
import { readState, writeState } from "../core/config.js";
import type { MakeState, MakeAction, ProcessedCluster } from "../core/config.js";

export const MAKE_PIPELINE_VERSION = 1;
const SKIP_TTL_DAYS = 30;

function emptyMakeState(): MakeState {
  return {
    pipelineVersion: MAKE_PIPELINE_VERSION,
    processedClusters: {},
  };
}

export async function readMakeState(): Promise<MakeState> {
  const state = await readState();
  if (!state.make || state.make.pipelineVersion !== MAKE_PIPELINE_VERSION) {
    return emptyMakeState();
  }
  return state.make;
}

export async function writeMakeState(make: MakeState): Promise<void> {
  const state = await readState();
  state.make = { ...make, pipelineVersion: MAKE_PIPELINE_VERSION };
  await writeState(state);
}

/**
 * Stable fingerprint for a cluster — SHA-256 over sorted member nugget IDs.
 * Survives cluster re-rank between runs.
 */
export function clusterFingerprint(cluster: NuggetCluster): string {
  const ids = cluster.members.map((m) => m.id).sort();
  return createHash("sha256").update(ids.join("|")).digest("hex").slice(0, 16);
}

function daysSince(iso: string, now: Date): number {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return Infinity;
  return (now.getTime() - then) / (1000 * 60 * 60 * 24);
}

/**
 * Should this cluster be run through `sks make` now?
 * - Never-seen cluster: yes
 * - Previously EDITed or CREATEd: no (until the target skill is deleted —
 *   handled by `invalidateDeletedTargets`)
 * - Previously SKIPped: yes only if the skip is older than 30 days
 */
export function needsMaking(
  cluster: NuggetCluster,
  state: MakeState,
  now: Date = new Date()
): boolean {
  const fp = clusterFingerprint(cluster);
  const entry = state.processedClusters[fp];
  if (!entry) return true;
  if (entry.action === "skip") {
    return daysSince(entry.processedAt, now) > SKIP_TTL_DAYS;
  }
  return false;
}

export function recordAction(
  state: MakeState,
  cluster: NuggetCluster,
  action: MakeAction,
  extras: { targetSkill?: string; reason?: string } = {}
): MakeState {
  const fp = clusterFingerprint(cluster);
  const entry: ProcessedCluster = {
    action,
    processedAt: new Date().toISOString(),
    ...(extras.targetSkill ? { targetSkill: extras.targetSkill } : {}),
    ...(extras.reason ? { reason: extras.reason } : {}),
  };
  return {
    ...state,
    processedClusters: { ...state.processedClusters, [fp]: entry },
  };
}

/**
 * Drop edit/create entries whose target skill no longer exists in the
 * canonical store. These clusters should be re-evaluated on the next run.
 */
export function invalidateDeletedTargets(
  state: MakeState,
  existingSkillNames: Set<string>
): MakeState {
  const next: Record<string, ProcessedCluster> = {};
  for (const [fp, entry] of Object.entries(state.processedClusters)) {
    if (entry.action === "skip") {
      next[fp] = entry;
      continue;
    }
    if (entry.targetSkill && existingSkillNames.has(entry.targetSkill)) {
      next[fp] = entry;
    }
    // else: skill was deleted — drop entry so cluster is re-considered
  }
  return { ...state, processedClusters: next };
}

export function finalizeMakeRun(state: MakeState): MakeState {
  return { ...state, lastRunAt: new Date().toISOString() };
}
