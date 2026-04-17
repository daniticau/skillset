import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_ROOT = join(tmpdir(), `skillset-reviewed-test-${process.pid}`);

vi.mock("../src/core/paths.js", () => ({
  STORE_ROOT: TEST_ROOT,
  STORE_SKILLS_DIR: join(TEST_ROOT, "skills"),
  CONFLICTS_DIR: join(TEST_ROOT, "conflicts"),
  CONFIG_FILE: join(TEST_ROOT, "config.json"),
  STATE_FILE: join(TEST_ROOT, "state.json"),
  DEFAULT_CLAUDE_SKILLS_DIR: join(TEST_ROOT, "mirror"),
  SESSIONS_DIR: join(TEST_ROOT, "sessions"),
}));

const { recordReviewedToday, __todayKey } = await import("../src/mine/cycle/reviewed.js");
const { readState } = await import("../src/core/config.js");

beforeEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(TEST_ROOT, { recursive: true });
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe("recordReviewedToday", () => {
  it("creates a fresh daily bucket on first call", async () => {
    const record = await recordReviewedToday({ skillsProduced: 2 });
    expect(record.cyclesRan).toBe(1);
    expect(record.skillsProduced).toBe(2);
    expect(record.skillsMerged).toBe(0);
    expect(record.skillsPruned).toBe(0);

    const state = await readState();
    const key = __todayKey(new Date());
    expect(state.reviewedDates?.[key]).toEqual(record);
  });

  it("increments counters on subsequent cycles same day", async () => {
    await recordReviewedToday({ skillsProduced: 1 });
    const r = await recordReviewedToday({ skillsProduced: 2, skillsMerged: 1 });
    expect(r.cyclesRan).toBe(2);
    expect(r.skillsProduced).toBe(3);
    expect(r.skillsMerged).toBe(1);
  });

  it("buckets separate dates independently", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await recordReviewedToday({ skillsProduced: 1 }, yesterday);
    await recordReviewedToday({ skillsProduced: 5 });

    const state = await readState();
    const keys = Object.keys(state.reviewedDates ?? {});
    expect(keys.length).toBe(2);
  });
});
