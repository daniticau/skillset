/**
 * Auto-prune pass — DRY-RUN ONLY in v1.
 *
 * Identifies candidates for deletion without actually deleting them. The user
 * validates the heuristic by watching the log; enabling real deletion is a
 * later opt-in (config.cleanup.pruneEnabled).
 *
 * Current eligibility (conservative):
 *   - origin === "auto-created"
 *   - userEdited === false
 *   - createdAt older than 60 days
 *   - lastEditedAt absent (no signal that cleanup cares about it)
 *   - no observed usage events
 */

import { readState } from "../../core/config.js";
import { readUsageEvents, summarizeUsage } from "../../usage/events.js";

export interface PruneOutcome {
  name: string;
  reason: string;
  dryRun: boolean;
}

export interface PruneOptions {
  enabled: boolean;
  cap: number;
  onEvent?: (event: string, detail?: string) => void;
}

const STALE_AGE_DAYS = 60;

function daysBetween(isoA: string, isoB: string): number {
  const a = Date.parse(isoA);
  const b = Date.parse(isoB);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return (b - a) / (1000 * 60 * 60 * 24);
}

export async function runPrune(
  names: string[],
  options: PruneOptions
): Promise<PruneOutcome[]> {
  const onEvent = options.onEvent ?? (() => {});
  if (options.cap <= 0) return [];
  const state = await readState();
  const usage = summarizeUsage(await readUsageEvents());
  const today = new Date().toISOString();

  const candidates: PruneOutcome[] = [];
  for (const name of names) {
    const s = state.skills[name];
    if (!s) continue;
    if (s.origin !== "auto-created") continue;
    if (s.userEdited) continue;
    if (!s.createdAt) continue;

    const ageDays = daysBetween(s.createdAt, today);
    if (ageDays < STALE_AGE_DAYS) continue;
    if (s.lastEditedAt) continue; // signal that skill has evolved; leave alone
    if ((usage.get(name)?.count ?? 0) > 0) continue;

    const reason = `auto-created, no edits in ${Math.floor(ageDays)}d`;
    candidates.push({ name, reason, dryRun: !options.enabled });
    if (candidates.length >= options.cap) break;
  }

  for (const c of candidates) {
    if (c.dryRun) {
      onEvent("prune-candidate", `${c.name} — ${c.reason} (dry-run)`);
    } else {
      onEvent("prune-would-delete", `${c.name} — ${c.reason}`);
      // v1: do not actually delete. Flip options.enabled to true in a later
      // patch once the user confirms the heuristic behaves well.
    }
  }

  return candidates;
}
