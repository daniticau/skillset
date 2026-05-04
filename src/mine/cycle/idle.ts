/**
 * macOS idle detection for the nightly dream cycle.
 *
 * The LaunchAgent fires at a wall-clock time, then this gate checks recent HID
 * input and rough CPU usage so the cycle avoids stealing compute while the user
 * is actively working.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export interface IdleStatus {
  idle: boolean;
  /** Seconds since last user input (keyboard/mouse). undefined on probe fail. */
  inactivitySec?: number;
  /** Recent CPU % (0-100+ summed across processes). undefined on probe fail. */
  cpuPct?: number;
  /** Human reason when idle=false, or the diagnostic when probe failed. */
  reason?: string;
}

export interface IdleThresholds {
  /** Machine is busy if CPU > this for the sample. Default 30. */
  cpuPct: number;
  /** Machine is busy if user input seen within this many minutes. Default 5. */
  inactivityMin: number;
}

const DEFAULT_THRESHOLDS: IdleThresholds = {
  cpuPct: 30,
  inactivityMin: 5,
};

let cache: { at: number; status: IdleStatus } | null = null;
const CACHE_TTL_MS = 30_000;

export function __clearIdleCache(): void {
  cache = null;
}

async function readInactivitySec(): Promise<number | undefined> {
  try {
    const { stdout } = await execFileP("ioreg", ["-c", "IOHIDSystem"], {
      timeout: 5000,
    });
    const match = stdout.match(/"HIDIdleTime"\s*=\s*(\d+)/);
    if (!match) return undefined;
    return Number(match[1]) / 1_000_000_000;
  } catch {
    return undefined;
  }
}

async function readCpuPct(): Promise<number | undefined> {
  try {
    const { stdout } = await execFileP("ps", ["-A", "-o", "%cpu"], {
      timeout: 5000,
    });
    const values = stdout
      .split(/\r?\n/)
      .map((line) => Number(line.trim()))
      .filter((value) => Number.isFinite(value));
    if (values.length === 0) return undefined;
    return values.reduce((sum, value) => sum + value, 0);
  } catch {
    return undefined;
  }
}

export async function isIdle(
  thresholds: Partial<IdleThresholds> = {}
): Promise<IdleStatus> {
  const cfg: IdleThresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };

  if (process.platform !== "darwin") {
    return {
      idle: true,
      reason: `idle probe skipped — sks dream only supports macOS (got ${process.platform})`,
    };
  }

  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.status;
  }

  const [inactivitySec, cpuPct] = await Promise.all([
    readInactivitySec(),
    readCpuPct(),
  ]);

  if (inactivitySec == null || cpuPct == null) {
    const status: IdleStatus = {
      idle: true,
      inactivitySec,
      cpuPct,
      reason: "idle probe incomplete — running anyway",
    };
    cache = { at: Date.now(), status };
    return status;
  }

  const inactivityMinActual = inactivitySec / 60;
  const isIdleEnough =
    inactivityMinActual >= cfg.inactivityMin && cpuPct <= cfg.cpuPct;

  const status: IdleStatus = {
    idle: isIdleEnough,
    inactivitySec,
    cpuPct,
    reason: isIdleEnough
      ? undefined
      : `busy — cpu=${cpuPct.toFixed(1)}% (limit ${cfg.cpuPct}), input=${inactivityMinActual.toFixed(1)}min ago (need >= ${cfg.inactivityMin}min)`,
  };
  cache = { at: Date.now(), status };
  return status;
}
