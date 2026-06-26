import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(tmpdir(), `skillset-cleanup-dry-run-${process.pid}`);
const STORE = join(ROOT, "store");
const SKILLS = join(STORE, "skills");
const CONFLICTS = join(STORE, "conflicts");
const STATE = join(STORE, "state.json");

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
}));

vi.mock("../src/core/paths.js", () => ({
  STORE_ROOT: STORE,
  STORE_SKILLS_DIR: SKILLS,
  SESSIONS_DIR: join(STORE, "sessions"),
  CONFLICTS_DIR: CONFLICTS,
  CONFIG_FILE: join(STORE, "config.json"),
  STATE_FILE: STATE,
  DEFAULT_CLAUDE_SKILLS_DIR: join(ROOT, "claude-skills"),
  DEFAULT_CODEX_SKILLS_DIR: join(ROOT, "codex-skills"),
}));

vi.mock("../src/mine/llm/index.js", async () => {
  const actual = await vi.importActual<typeof import("../src/mine/llm/index.js")>(
    "../src/mine/llm/index.js"
  );
  return {
    ...actual,
    chat: mocks.chat,
  };
});

const { runCleanup } = await import("../src/mine/cleanup/index.js");
const { runDedupMerge } = await import("../src/mine/cleanup/dedup-merge.js");
const { writeState, readState } = await import("../src/core/config.js");

function makeSkill(
  name: string,
  description: string,
  body: string,
  origin = "auto-created"
): void {
  const dir = join(SKILLS, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\norigin: ${origin}\n---\n\n${body}\n`,
    "utf8"
  );
}

async function seedConflictingSkills(): Promise<void> {
  mkdirSync(SKILLS, { recursive: true });
  makeSkill("indent-tabs", "Indentation preference for generated code", "Always indent generated code with tabs.");
  makeSkill("indent-spaces", "Indentation preference for generated code", "Always indent generated code with two spaces.");
  await writeState({
    version: 2,
    reviewedDates: {},
    skills: {
      "indent-tabs": {
        canonicalHash: "a",
        mirrorHashes: {},
        userEdited: false,
        origin: "auto-created",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      "indent-spaces": {
        canonicalHash: "b",
        mirrorHashes: {},
        userEdited: false,
        origin: "auto-created",
        createdAt: "2026-02-01T00:00:00.000Z",
      },
    },
  });
}

beforeEach(async () => {
  rmSync(ROOT, { recursive: true, force: true });
  await seedConflictingSkills();
  mocks.chat.mockReset();
  mocks.chat.mockResolvedValue({
    content: JSON.stringify({
      conflict: true,
      confidence: 0.95,
      quoteA: "Always indent generated code with two spaces.",
      quoteB: "Always indent generated code with tabs.",
      rationale: "Opposite indentation rules.",
    }),
    tokensIn: 0,
    tokensOut: 0,
    model: "mock",
    latencyMs: 1,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(ROOT, { recursive: true, force: true });
});

describe("cleanup dry-run safety", () => {
  it("reports conflicts without mutating canonical files, state, or archives", async () => {
    const beforeState = readFileSync(STATE, "utf8");

    const events: string[] = [];
    const report = await runCleanup({
      llmConfig: { provider: "ollama", baseUrl: "mock", model: "mock", timeout: 1000, maxRetries: 1 },
      mergeCap: 1,
      pruneEnabled: false,
      pruneCap: 0,
      dryRun: true,
      onEvent: (event, detail) => events.push(`${event}:${detail ?? ""}`),
    });

    expect(mocks.chat).toHaveBeenCalled();
    expect(report.conflictsResolved).toHaveLength(1);
    expect(report.conflictsResolved[0]).toMatchObject({
      winner: "indent-spaces",
      loser: "indent-tabs",
      dryRun: true,
    });
    expect(existsSync(join(SKILLS, "indent-tabs", "SKILL.md"))).toBe(true);
    expect(existsSync(join(SKILLS, "indent-spaces", "SKILL.md"))).toBe(true);
    expect(existsSync(CONFLICTS)).toBe(false);
    expect(readFileSync(STATE, "utf8")).toBe(beforeState);
  });

  it("applies confirmed conflicts when dryRun is false", async () => {
    const report = await runCleanup({
      llmConfig: { provider: "ollama", baseUrl: "mock", model: "mock", timeout: 1000, maxRetries: 1 },
      mergeCap: 1,
      pruneEnabled: false,
      pruneCap: 0,
      dryRun: false,
    });

    expect(report.conflictsResolved).toHaveLength(1);
    expect(report.conflictsResolved[0]?.dryRun).toBe(false);
    expect(report.conflictsResolved[0]?.archivePath).toBeTruthy();
    expect(existsSync(join(SKILLS, "indent-tabs", "SKILL.md"))).toBe(false);
    expect(existsSync(join(SKILLS, "indent-spaces", "SKILL.md"))).toBe(true);
    expect(existsSync(report.conflictsResolved[0]!.archivePath!)).toBe(true);
    const state = await readState();
    expect(state.skills["indent-tabs"]).toBeUndefined();
    expect(state.skills["indent-spaces"]).toBeDefined();
  });

  it("reports dedup merges in dry-run mode without replacing skills", async () => {
    mocks.chat.mockResolvedValueOnce({
      content: JSON.stringify({
        merge: true,
        confidence: 0.92,
        rationale: "Both rules say the same thing.",
        merged: {
          name: "prefer-pnpm",
          description: "Prefer pnpm for package management",
          body: "Use pnpm for package management commands.",
        },
      }),
      tokensIn: 0,
      tokensOut: 0,
      model: "mock",
      latencyMs: 1,
    });
    const beforeState = readFileSync(STATE, "utf8");

    const outcomes = await runDedupMerge(
      ["indent-spaces", "indent-tabs"],
      { provider: "ollama", baseUrl: "mock", model: "mock", timeout: 1000, maxRetries: 1 },
      1,
      () => {},
      { dryRun: true }
    );

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      replaced: ["indent-spaces", "indent-tabs"],
      produced: "prefer-pnpm",
      dryRun: true,
    });
    expect(outcomes[0]?.archivePath).toBeUndefined();
    expect(existsSync(join(SKILLS, "prefer-pnpm", "SKILL.md"))).toBe(false);
    expect(existsSync(join(SKILLS, "indent-tabs", "SKILL.md"))).toBe(true);
    expect(existsSync(join(SKILLS, "indent-spaces", "SKILL.md"))).toBe(true);
    expect(existsSync(CONFLICTS)).toBe(false);
    expect(readFileSync(STATE, "utf8")).toBe(beforeState);
  });

  it("retires auto-created skills already covered by user-authored skills", async () => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(SKILLS, { recursive: true });
    makeSkill(
      "ios-prep-skill",
      "Do iOS app prep for a local iOS app repo",
      "From inside an iOS app repo, create AppStorePackage with App Store submission materials.",
      "user-created"
    );
    makeSkill(
      "ios-prep-from-app-folder",
      "Apply when the user asks to do iOS app prep from inside an iOS app repository or app folder",
      "When the user says do iOS prep while the current working directory is an iOS app folder, treat the app folder as the input.",
      "auto-created"
    );
    await writeState({
      version: 2,
      reviewedDates: {},
      skills: {
        "ios-prep-skill": {
          canonicalHash: "u",
          mirrorHashes: {},
          userEdited: false,
          origin: "user-created",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        "ios-prep-from-app-folder": {
          canonicalHash: "a",
          mirrorHashes: {},
          userEdited: false,
          origin: "auto-created",
          createdAt: "2026-02-01T00:00:00.000Z",
        },
      },
    });
    mocks.chat.mockResolvedValueOnce({
      content: JSON.stringify({
        covered: true,
        confidence: 0.93,
        rationale: "The auto skill is a subset of the iOS prep workflow.",
      }),
      tokensIn: 0,
      tokensOut: 0,
      model: "mock",
      latencyMs: 1,
    });

    const report = await runCleanup({
      llmConfig: { provider: "ollama", baseUrl: "mock", model: "mock", timeout: 1000, maxRetries: 1 },
      mergeCap: 1,
      pruneEnabled: false,
      pruneCap: 0,
      dryRun: false,
    });

    expect(report.coveredByUser).toHaveLength(1);
    expect(report.coveredByUser[0]).toMatchObject({
      redundant: "ios-prep-from-app-folder",
      coveredBy: "ios-prep-skill",
      dryRun: false,
    });
    expect(existsSync(join(SKILLS, "ios-prep-skill", "SKILL.md"))).toBe(true);
    expect(existsSync(join(SKILLS, "ios-prep-from-app-folder", "SKILL.md"))).toBe(false);
    const state = await readState();
    expect(state.skills["ios-prep-skill"]).toBeDefined();
    expect(state.skills["ios-prep-from-app-folder"]).toBeUndefined();
  });

  it("does not retire user-edited auto-created skills during cleanup", async () => {
    rmSync(ROOT, { recursive: true, force: true });
    mkdirSync(SKILLS, { recursive: true });
    makeSkill(
      "careful-release",
      "Confirm release actions",
      "Ask before clicking release buttons.",
      "auto-created"
    );
    makeSkill(
      "careful-release-copy",
      "Confirm release actions",
      "Ask before clicking release buttons.",
      "auto-created"
    );
    await writeState({
      version: 2,
      reviewedDates: {},
      skills: {
        "careful-release": {
          canonicalHash: "u",
          mirrorHashes: {},
          userEdited: true,
          origin: "auto-created",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        "careful-release-copy": {
          canonicalHash: "a",
          mirrorHashes: {},
          userEdited: false,
          origin: "auto-created",
          createdAt: "2026-02-01T00:00:00.000Z",
        },
      },
    });

    const report = await runCleanup({
      llmConfig: { provider: "ollama", baseUrl: "mock", model: "mock", timeout: 1000, maxRetries: 1 },
      mergeCap: 1,
      pruneEnabled: false,
      pruneCap: 0,
      dryRun: false,
    });

    expect(report.conflictsResolved).toHaveLength(0);
    expect(report.merges).toHaveLength(0);
    expect(existsSync(join(SKILLS, "careful-release", "SKILL.md"))).toBe(true);
    expect(existsSync(join(SKILLS, "careful-release-copy", "SKILL.md"))).toBe(true);
  });
});
