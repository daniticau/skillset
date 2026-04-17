import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_ROOT = join(tmpdir(), `skillset-checkpoint-test-${process.pid}`);

vi.mock("../src/core/paths.js", () => ({
  STORE_ROOT: TEST_ROOT,
  STORE_SKILLS_DIR: join(TEST_ROOT, "skills"),
  CONFLICTS_DIR: join(TEST_ROOT, "conflicts"),
  CONFIG_FILE: join(TEST_ROOT, "config.json"),
  STATE_FILE: join(TEST_ROOT, "state.json"),
  DEFAULT_CLAUDE_SKILLS_DIR: join(TEST_ROOT, "mirror"),
  SESSIONS_DIR: join(TEST_ROOT, "sessions"),
}));

const {
  startCheckpoint,
  loadCheckpoint,
  advanceCheckpoint,
  clearCheckpoint,
  shouldRunStage,
  STAGE_ORDER,
  stageIndex,
} = await import("../src/mine/cycle/checkpoint.js");

beforeEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(TEST_ROOT, { recursive: true });
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe("cycle checkpoint", () => {
  it("startCheckpoint writes a fresh cycle with stage=init", async () => {
    const cp = await startCheckpoint("deep-dive", { maxSkills: 10 });
    expect(cp.kind).toBe("deep-dive");
    expect(cp.stage).toBe("init");
    expect(cp.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(cp.progress).toEqual({ maxSkills: 10 });

    const loaded = await loadCheckpoint("deep-dive");
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(cp.id);
  });

  it("loadCheckpoint returns null when kind doesn't match", async () => {
    await startCheckpoint("deep-dive");
    const mismatch = await loadCheckpoint("nightly");
    expect(mismatch).toBeNull();
  });

  it("loadCheckpoint returns null when nothing persisted", async () => {
    const loaded = await loadCheckpoint("deep-dive");
    expect(loaded).toBeNull();
  });

  it("advanceCheckpoint moves stage and merges progress", async () => {
    await startCheckpoint("deep-dive", { maxSkills: 10 });
    await advanceCheckpoint("scraped", { sessionCount: 42 });
    const loaded = await loadCheckpoint("deep-dive");
    expect(loaded!.stage).toBe("scraped");
    expect(loaded!.progress).toEqual({ maxSkills: 10, sessionCount: 42 });
  });

  it("advanceCheckpoint without start throws", async () => {
    await expect(advanceCheckpoint("scraped")).rejects.toThrow(/no currentCycle/);
  });

  it("clearCheckpoint removes it", async () => {
    await startCheckpoint("deep-dive");
    await clearCheckpoint();
    const loaded = await loadCheckpoint("deep-dive");
    expect(loaded).toBeNull();
  });

  it("shouldRunStage skips already-completed stages", () => {
    expect(shouldRunStage("scraped", "init")).toBe(false);
    expect(shouldRunStage("scraped", "scraped")).toBe(false);
    expect(shouldRunStage("scraped", "heuristic-done")).toBe(true);
    expect(shouldRunStage(undefined, "init")).toBe(true);
  });

  it("STAGE_ORDER is monotonically sorted for stageIndex", () => {
    for (let i = 1; i < STAGE_ORDER.length; i++) {
      expect(stageIndex(STAGE_ORDER[i]!)).toBeGreaterThan(stageIndex(STAGE_ORDER[i - 1]!));
    }
  });
});
