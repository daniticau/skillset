/**
 * Incremental processing state for the mine pipeline.
 * Tracks which session files have been processed at which stage,
 * so repeated `mine` runs only touch new/changed sessions.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readState, writeState } from "../core/config.js";
import type { MineState, MineStage } from "../core/config.js";

export const MINE_PIPELINE_VERSION = 1;

const STAGE_ORDER: Record<MineStage, number> = {
  heuristic: 0,
  "llm-validated": 1,
  embedded: 2,
};

function emptyMineState(): MineState {
  return {
    pipelineVersion: MINE_PIPELINE_VERSION,
    processedSessions: {},
  };
}

/** Load the mine state from ~/.skillset/state.json. */
export async function readMineState(): Promise<MineState> {
  const state = await readState();
  if (!state.mine || state.mine.pipelineVersion !== MINE_PIPELINE_VERSION) {
    return emptyMineState();
  }
  return state.mine;
}

/** Save the mine state back to ~/.skillset/state.json. */
export async function writeMineState(mine: MineState): Promise<void> {
  const state = await readState();
  state.mine = { ...mine, pipelineVersion: MINE_PIPELINE_VERSION };
  await writeState(state);
}

/** SHA-256 of a session JSONL file. */
export function sessionFileHash(filePath: string): string {
  try {
    const buf = readFileSync(filePath);
    return createHash("sha256").update(buf).digest("hex").slice(0, 16);
  } catch {
    return "";
  }
}

/**
 * Does this session need processing at the target stage?
 * Returns true if the session is new, the file changed, or the stored stage is lower than target.
 */
export function needsProcessing(
  sessionId: string,
  currentHash: string,
  mineState: MineState,
  targetStage: MineStage
): boolean {
  const entry = mineState.processedSessions[sessionId];
  if (!entry) return true;
  if (entry.fileHash !== currentHash) return true;
  return STAGE_ORDER[entry.stage] < STAGE_ORDER[targetStage];
}

/** Mark a session as processed at a given stage. */
export function markProcessed(
  mineState: MineState,
  sessionId: string,
  fileHash: string,
  stage: MineStage
): MineState {
  return {
    ...mineState,
    processedSessions: {
      ...mineState.processedSessions,
      [sessionId]: {
        fileHash,
        processedAt: new Date().toISOString(),
        stage,
      },
    },
  };
}

/** Mark the full run as complete. */
export function finalizeRun(mineState: MineState): MineState {
  return { ...mineState, lastRunAt: new Date().toISOString() };
}
