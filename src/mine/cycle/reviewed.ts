/**
 * Per-day rollup of what the nightly loop did. Lives in state.reviewedDates
 * keyed by local YYYY-MM-DD, so the user (and future cleanup heuristics) can
 * see cycle history at a glance.
 */

import { readState, writeState } from "../../core/config.js";
import type { ReviewedDateRecord } from "../../core/config.js";

function todayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export interface ReviewRecordDelta {
  status?: ReviewedDateRecord["status"];
  cycleId?: string;
  sessionsReviewed?: number;
  mistakeClusters?: number;
  preferenceClusters?: number;
  skillsCreated?: number;
  skillsEdited?: number;
  skillsProduced?: number;
  skillsMerged?: number;
  skillsPruned?: number;
  skipReason?: string;
}

function emptyRecord(): ReviewedDateRecord {
  return {
    status: "started",
    cyclesRan: 0,
    sessionsReviewed: 0,
    mistakeClusters: 0,
    preferenceClusters: 0,
    skillsCreated: 0,
    skillsEdited: 0,
    skillsProduced: 0,
    skillsMerged: 0,
    skillsPruned: 0,
  };
}

/**
 * Record an executed cycle for today. Increments cyclesRan and adds the delta
 * counts. Idempotent-per-call (callers are expected to call once per cycle).
 */
export async function recordReviewedToday(
  delta: ReviewRecordDelta = {},
  when = new Date()
): Promise<ReviewedDateRecord> {
  const key = todayKey(when);
  const state = await readState();
  const map = state.reviewedDates ?? {};
  const prior = map[key] ?? emptyRecord();
  const now = new Date().toISOString();
  const status = delta.status ?? "completed";
  const skillsCreated = prior.skillsCreated + (delta.skillsCreated ?? delta.skillsProduced ?? 0);
  const next: ReviewedDateRecord = {
    ...prior,
    status,
    startedAt: prior.startedAt ?? now,
    finishedAt: status === "completed" || status === "failed" || status === "skipped" ? now : prior.finishedAt,
    cycleId: delta.cycleId ?? prior.cycleId,
    cyclesRan: status === "skipped" ? prior.cyclesRan : prior.cyclesRan + 1,
    sessionsReviewed: prior.sessionsReviewed + (delta.sessionsReviewed ?? 0),
    mistakeClusters: prior.mistakeClusters + (delta.mistakeClusters ?? 0),
    preferenceClusters: prior.preferenceClusters + (delta.preferenceClusters ?? 0),
    skillsCreated,
    skillsEdited: prior.skillsEdited + (delta.skillsEdited ?? 0),
    skillsProduced: prior.skillsProduced + (delta.skillsProduced ?? delta.skillsCreated ?? 0),
    skillsMerged: prior.skillsMerged + (delta.skillsMerged ?? 0),
    skillsPruned: prior.skillsPruned + (delta.skillsPruned ?? 0),
    skipReason: delta.skipReason ?? prior.skipReason,
  };
  state.reviewedDates = { ...map, [key]: next };
  await writeState(state);
  return next;
}

export async function markReviewStarted(
  delta: ReviewRecordDelta = {},
  when = new Date()
): Promise<ReviewedDateRecord> {
  const key = todayKey(when);
  const state = await readState();
  const map = state.reviewedDates ?? {};
  const prior = map[key] ?? emptyRecord();
  const next: ReviewedDateRecord = {
    ...prior,
    status: "started",
    startedAt: prior.startedAt ?? new Date().toISOString(),
    cycleId: delta.cycleId ?? prior.cycleId,
    skipReason: undefined,
  };
  state.reviewedDates = { ...map, [key]: next };
  await writeState(state);
  return next;
}

export async function markReviewSkipped(
  reason: string,
  when = new Date()
): Promise<ReviewedDateRecord> {
  return recordReviewedToday({ status: "skipped", skipReason: reason }, when);
}

export async function hasCompletedReviewToday(when = new Date()): Promise<boolean> {
  const state = await readState();
  return state.reviewedDates?.[todayKey(when)]?.status === "completed";
}

export function __todayKey(when: Date): string {
  return todayKey(when);
}
