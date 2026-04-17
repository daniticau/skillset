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
  skillsProduced?: number;
  skillsMerged?: number;
  skillsPruned?: number;
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
  const prior = map[key] ?? {
    cyclesRan: 0,
    skillsProduced: 0,
    skillsMerged: 0,
    skillsPruned: 0,
  };
  const next: ReviewedDateRecord = {
    cyclesRan: prior.cyclesRan + 1,
    skillsProduced: prior.skillsProduced + (delta.skillsProduced ?? 0),
    skillsMerged: prior.skillsMerged + (delta.skillsMerged ?? 0),
    skillsPruned: prior.skillsPruned + (delta.skillsPruned ?? 0),
  };
  state.reviewedDates = { ...map, [key]: next };
  await writeState(state);
  return next;
}

export function __todayKey(when: Date): string {
  return todayKey(when);
}
