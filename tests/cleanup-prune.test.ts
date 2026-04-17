import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_ROOT = join(tmpdir(), `skillset-prune-test-${process.pid}`);

vi.mock("../src/core/paths.js", () => ({
  STORE_ROOT: TEST_ROOT,
  STORE_SKILLS_DIR: join(TEST_ROOT, "skills"),
  CONFLICTS_DIR: join(TEST_ROOT, "conflicts"),
  CONFIG_FILE: join(TEST_ROOT, "config.json"),
  STATE_FILE: join(TEST_ROOT, "state.json"),
  DEFAULT_CLAUDE_SKILLS_DIR: join(TEST_ROOT, "mirror"),
  SESSIONS_DIR: join(TEST_ROOT, "sessions"),
}));

const { runPrune } = await import("../src/mine/cleanup/prune.js");
const { eligibleSkills } = await import("../src/mine/cleanup/index.js");
const { writeState } = await import("../src/core/config.js");

function stateFixture(
  skills: Record<string, Record<string, unknown>>
): void {
  const state = {
    version: 2,
    skills,
    reviewedDates: {},
  };
  writeFileSync(join(TEST_ROOT, "state.json"), JSON.stringify(state, null, 2));
}

beforeEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(TEST_ROOT, { recursive: true });
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe("runPrune (dry-run)", () => {
  it("flags auto-created skills older than 60 days as candidates", async () => {
    const old = new Date(Date.now() - 70 * 24 * 3600 * 1000).toISOString();
    await writeState({
      version: 2,
      skills: {
        stale: {
          canonicalHash: "",
          mirrorHashes: {},
          userEdited: false,
          origin: "auto-created",
          createdAt: old,
        },
      },
    });
    const candidates = await runPrune(["stale"], { enabled: false, cap: 5 });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.name).toBe("stale");
    expect(candidates[0]!.dryRun).toBe(true);
  });

  it("never flags origin=user-created", async () => {
    const old = new Date(Date.now() - 70 * 24 * 3600 * 1000).toISOString();
    await writeState({
      version: 2,
      skills: {
        user: {
          canonicalHash: "",
          mirrorHashes: {},
          userEdited: false,
          origin: "user-created",
          createdAt: old,
        },
      },
    });
    const candidates = await runPrune(["user"], { enabled: false, cap: 5 });
    expect(candidates).toHaveLength(0);
  });

  it("never flags auto-created + userEdited=true", async () => {
    const old = new Date(Date.now() - 70 * 24 * 3600 * 1000).toISOString();
    await writeState({
      version: 2,
      skills: {
        touched: {
          canonicalHash: "",
          mirrorHashes: {},
          userEdited: true,
          origin: "auto-created",
          createdAt: old,
        },
      },
    });
    const candidates = await runPrune(["touched"], { enabled: false, cap: 5 });
    expect(candidates).toHaveLength(0);
  });

  it("doesn't flag skills with a lastEditedAt (evolving skill)", async () => {
    const old = new Date(Date.now() - 70 * 24 * 3600 * 1000).toISOString();
    const recent = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
    await writeState({
      version: 2,
      skills: {
        evolving: {
          canonicalHash: "",
          mirrorHashes: {},
          userEdited: false,
          origin: "auto-created",
          createdAt: old,
          lastEditedAt: recent,
        },
      },
    });
    const candidates = await runPrune(["evolving"], { enabled: false, cap: 5 });
    expect(candidates).toHaveLength(0);
  });

  it("doesn't flag skills younger than 60 days", async () => {
    const recent = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    await writeState({
      version: 2,
      skills: {
        young: {
          canonicalHash: "",
          mirrorHashes: {},
          userEdited: false,
          origin: "auto-created",
          createdAt: recent,
        },
      },
    });
    const candidates = await runPrune(["young"], { enabled: false, cap: 5 });
    expect(candidates).toHaveLength(0);
  });

  it("respects the cap", async () => {
    const old = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
    await writeState({
      version: 2,
      skills: {
        a: {
          canonicalHash: "",
          mirrorHashes: {},
          userEdited: false,
          origin: "auto-created",
          createdAt: old,
        },
        b: {
          canonicalHash: "",
          mirrorHashes: {},
          userEdited: false,
          origin: "auto-created",
          createdAt: old,
        },
        c: {
          canonicalHash: "",
          mirrorHashes: {},
          userEdited: false,
          origin: "auto-created",
          createdAt: old,
        },
      },
    });
    const candidates = await runPrune(["a", "b", "c"], { enabled: false, cap: 2 });
    expect(candidates).toHaveLength(2);
  });
});

describe("eligibleSkills", () => {
  it("includes auto-created, excludes user-created", async () => {
    stateFixture({
      auto: { canonicalHash: "", mirrorHashes: {}, userEdited: false, origin: "auto-created", createdAt: "2026-01-01" },
      user: { canonicalHash: "", mirrorHashes: {}, userEdited: false, origin: "user-created", createdAt: "2026-01-01" },
      auto2: { canonicalHash: "", mirrorHashes: {}, userEdited: true, origin: "auto-created", createdAt: "2026-01-01" },
    });
    const list = await eligibleSkills();
    expect(list).toEqual(["auto", "auto2"]);
  });
});
