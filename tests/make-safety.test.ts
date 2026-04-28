import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(tmpdir(), `skillset-make-safety-${process.pid}`);
const STORE = join(ROOT, "store");
const SKILLS = join(STORE, "skills");
const NUGGETS = join(STORE, "nuggets");
const CLUSTERS = join(NUGGETS, "clusters.json");
const USAGE = join(STORE, "usage");

const mocks = vi.hoisted(() => ({
  planSkillAction: vi.fn(),
  executeEdit: vi.fn(),
  executeCreate: vi.fn(),
}));

vi.mock("../src/core/paths.js", () => ({
  STORE_ROOT: STORE,
  STORE_SKILLS_DIR: SKILLS,
  SESSIONS_DIR: join(STORE, "sessions"),
  USAGE_DIR: USAGE,
  USAGE_EVENTS_FILE: join(USAGE, "events.jsonl"),
  CONFLICTS_DIR: join(STORE, "conflicts"),
  CONFIG_FILE: join(STORE, "config.json"),
  STATE_FILE: join(STORE, "state.json"),
  DEFAULT_CLAUDE_SKILLS_DIR: join(ROOT, "claude-skills"),
  DEFAULT_CODEX_SKILLS_DIR: join(ROOT, "codex-skills"),
}));

vi.mock("../src/mine/llm/index.js", () => ({
  defaultLLMConfig: () => ({ provider: "ollama", model: "mock-model", baseUrl: "mock" }),
  isAvailable: async () => ({ reachable: true, modelPresent: true, models: ["mock-model"] }),
}));

vi.mock("../src/mine/make.js", () => ({
  loadExistingSkillSummaries: async () => [
    { name: "user-owned", description: "user owned" },
    { name: "auto-owned", description: "auto owned" },
  ],
  planSkillAction: mocks.planSkillAction,
  executeEdit: mocks.executeEdit,
  executeCreate: mocks.executeCreate,
}));

const { makeCommand } = await import("../src/commands/make.js");
const { writeState } = await import("../src/core/config.js");

beforeEach(async () => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(SKILLS, { recursive: true });
  mkdirSync(NUGGETS, { recursive: true });
  await writeState({
    version: 2,
    reviewedDates: {},
    skills: {
      "user-owned": {
        canonicalHash: "u",
        mirrorHashes: {},
        userEdited: false,
        origin: "user-created",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      "auto-owned": {
        canonicalHash: "a",
        mirrorHashes: {},
        userEdited: false,
        origin: "auto-created",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    },
  });
  writeFileSync(
    CLUSTERS,
    JSON.stringify(
      [
        {
          id: "cluster-1",
          canonical: {
            id: "n1",
            category: "preference",
            signal: "Always do the thing",
            evidence: [{ sessionId: "s1", project: "p", userMessage: "Always do the thing" }],
            confidence: 1,
            source: "heuristic",
            createdAt: "2026-04-23T00:00:00.000Z",
          },
          members: [{ id: "n1" }],
          score: 1,
          projects: ["p"],
        },
      ],
      null,
      2
    ),
    "utf8"
  );
  mocks.executeEdit.mockReset();
  mocks.executeCreate.mockReset();
  mocks.planSkillAction.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(ROOT, { recursive: true, force: true });
});

describe("make command automation safety", () => {
  it("does not offer user-created skills as automated edit targets", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    let namesSeen: string[] = [];
    mocks.planSkillAction.mockImplementation(async (_cluster, summaries) => {
      namesSeen = summaries.map((s: { name: string }) => s.name);
      return { kind: "skip", reason: "verified" };
    });

    await makeCommand({ force: true });

    expect(mocks.planSkillAction).toHaveBeenCalledTimes(1);
    expect(namesSeen).toEqual(["auto-owned"]);
    expect(mocks.executeEdit).not.toHaveBeenCalled();
  });
});
