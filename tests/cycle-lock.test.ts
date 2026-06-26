import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_ROOT = join(tmpdir(), `skillset-lock-test-${process.pid}`);

vi.mock("../src/core/paths.js", () => ({
  STORE_ROOT: TEST_ROOT,
  STORE_SKILLS_DIR: join(TEST_ROOT, "skills"),
  CONFLICTS_DIR: join(TEST_ROOT, "conflicts"),
  CONFIG_FILE: join(TEST_ROOT, "config.json"),
  STATE_FILE: join(TEST_ROOT, "state.json"),
  DEFAULT_CLAUDE_SKILLS_DIR: join(TEST_ROOT, "mirror"),
  SESSIONS_DIR: join(TEST_ROOT, "sessions"),
}));

const { acquireLock, __lockFilePath } = await import("../src/mine/cycle/lock.js");
const LOCK_FILE = __lockFilePath();

beforeEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(TEST_ROOT, { recursive: true });
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

function setMtime(path: string, secondsAgo: number): void {
  const t = (Date.now() - secondsAgo * 1000) / 1000;
  utimesSync(path, t, t);
}

describe("acquireLock", () => {
  it("acquires when no lock file exists", async () => {
    const res = await acquireLock("nightly");
    expect(res.acquired).toBe(true);
    expect(existsSync(LOCK_FILE)).toBe(true);
    if (res.acquired) await res.release();
    expect(existsSync(LOCK_FILE)).toBe(false);
  });

  it("creates the store directory when acquiring the first lock", async () => {
    rmSync(TEST_ROOT, { recursive: true, force: true });

    const res = await acquireLock("nightly");

    expect(res.acquired).toBe(true);
    expect(existsSync(LOCK_FILE)).toBe(true);
    if (res.acquired) await res.release();
  });

  it("refuses when lock held by a live pid with recent heartbeat", async () => {
    // Simulate: another live process owns the lock, recent heartbeat.
    writeFileSync(
      LOCK_FILE,
      JSON.stringify({
        pid: process.pid, // own pid = guaranteed alive
        kind: "mine",
        startedAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
      })
    );
    const res = await acquireLock("nightly");
    expect(res.acquired).toBe(false);
    if (!res.acquired) {
      expect(res.reason).toMatch(/already running/);
      expect(res.holder.kind).toBe("mine");
    }
  });

  it("reclaims stale lock (>10min heartbeat)", async () => {
    const staleIso = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    writeFileSync(
      LOCK_FILE,
      JSON.stringify({
        pid: process.pid,
        kind: "mine",
        startedAt: staleIso,
        heartbeatAt: staleIso,
      })
    );
    setMtime(LOCK_FILE, 15 * 60); // 15 min old mtime
    const res = await acquireLock("nightly");
    expect(res.acquired).toBe(true);
    if (res.acquired) await res.release();
  });

  it("reclaims lock from a dead pid", async () => {
    // PID 999999 almost certainly doesn't exist.
    writeFileSync(
      LOCK_FILE,
      JSON.stringify({
        pid: 999_999,
        kind: "mine",
        startedAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
      })
    );
    const res = await acquireLock("nightly");
    expect(res.acquired).toBe(true);
    if (res.acquired) await res.release();
  });

  it("release is a no-op if someone else has since rewritten the lock", async () => {
    const res = await acquireLock("nightly");
    expect(res.acquired).toBe(true);
    if (!res.acquired) return;
    // Simulate another process replacing our lock
    writeFileSync(
      LOCK_FILE,
      JSON.stringify({
        pid: process.pid + 1,
        kind: "mine",
        startedAt: new Date().toISOString(),
      })
    );
    await res.release();
    expect(existsSync(LOCK_FILE)).toBe(true);
  });
});
