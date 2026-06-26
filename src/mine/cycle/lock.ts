/**
 * File-based mutex for state-mutating skillset commands.
 *
 * Prevents the scheduled nightly cycle from clobbering a manual `sks mine` /
 * `sks make` / `sks cycle` the user is running in the foreground, and vice
 * versa. Read-only commands (sync is mostly safe, status/list/doctor are
 * pure reads) do NOT acquire the lock.
 *
 * Lock file: ~/.skillset/.lock, JSON payload {pid, kind, startedAt}.
 *
 * Stale-lock reclaim: if the stored pid is not alive, OR the file mtime is
 * older than 10 minutes, we treat the lock as abandoned and reclaim it.
 */

import { mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { STORE_ROOT } from "../../core/paths.js";

const LOCK_FILE = join(STORE_ROOT, ".lock");
const STALE_MS = 10 * 60 * 1000; // 10 min

export type LockKind = "deep-dive" | "nightly" | "mine" | "make" | "cleanup";

export interface LockPayload {
  pid: number;
  kind: LockKind;
  startedAt: string;
  heartbeatAt?: string;
}

export interface AcquireResult {
  acquired: true;
  heartbeat: () => Promise<void>;
  release: () => Promise<void>;
}

export interface AcquireBusy {
  acquired: false;
  holder: LockPayload;
  reason: string;
}

function isPidAlive(pid: number): boolean {
  try {
    // Signal 0 probes existence without delivering. Throws EPERM on permission
    // errors (still means pid exists) and ESRCH when missing.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM") return true;
    return false;
  }
}

async function readLock(): Promise<LockPayload | null> {
  if (!existsSync(LOCK_FILE)) return null;
  try {
    const raw = await readFile(LOCK_FILE, "utf8");
    return JSON.parse(raw) as LockPayload;
  } catch {
    return null;
  }
}

async function writeLock(payload: LockPayload): Promise<void> {
  await mkdir(dirname(LOCK_FILE), { recursive: true });
  await writeFile(LOCK_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

async function lockMtimeMs(): Promise<number | null> {
  try {
    const s = await stat(LOCK_FILE);
    return s.mtimeMs;
  } catch {
    return null;
  }
}

export async function acquireLock(
  kind: LockKind
): Promise<AcquireResult | AcquireBusy> {
  const existing = await readLock();
  if (existing) {
    const alive = isPidAlive(existing.pid);
    const mtime = await lockMtimeMs();
    const stale =
      !alive ||
      (mtime !== null && Date.now() - mtime > STALE_MS) ||
      (existing.heartbeatAt !== undefined &&
        Date.now() - Date.parse(existing.heartbeatAt) > STALE_MS);
    if (!stale) {
      return {
        acquired: false,
        holder: existing,
        reason: `cycle already running — pid ${existing.pid} (${existing.kind}) since ${existing.startedAt}`,
      };
    }
    // Reclaim the stale lock by overwriting.
  }

  const payload: LockPayload = {
    pid: process.pid,
    kind,
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
  };
  await writeLock(payload);

  let heartbeatTimer: NodeJS.Timeout | null = setInterval(async () => {
    try {
      const cur = await readLock();
      if (!cur || cur.pid !== process.pid) return;
      await writeLock({ ...cur, heartbeatAt: new Date().toISOString() });
    } catch {
      // best-effort; the stale-reclaim path recovers if we die
    }
  }, 30_000);
  // Don't let the heartbeat keep the event loop alive on its own.
  heartbeatTimer.unref?.();

  const release = async () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    try {
      const cur = await readLock();
      if (cur && cur.pid === process.pid) {
        await rm(LOCK_FILE, { force: true });
      }
    } catch {
      // ignore
    }
  };

  const heartbeat = async () => {
    const cur = await readLock();
    if (!cur || cur.pid !== process.pid) return;
    await writeLock({ ...cur, heartbeatAt: new Date().toISOString() });
  };

  return { acquired: true, heartbeat, release };
}

/** For tests. */
export function __lockFilePath(): string {
  return LOCK_FILE;
}
