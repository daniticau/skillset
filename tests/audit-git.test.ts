import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileP = promisify(execFile);

const TEST_ROOT = join(tmpdir(), `skillset-audit-test-${process.pid}`);

vi.mock("../src/core/paths.js", () => ({
  STORE_ROOT: TEST_ROOT,
  STORE_SKILLS_DIR: join(TEST_ROOT, "skills"),
  CONFLICTS_DIR: join(TEST_ROOT, "conflicts"),
  CONFIG_FILE: join(TEST_ROOT, "config.json"),
  STATE_FILE: join(TEST_ROOT, "state.json"),
  DEFAULT_CLAUDE_SKILLS_DIR: join(TEST_ROOT, "mirror"),
  SESSIONS_DIR: join(TEST_ROOT, "sessions"),
  STORE_ROOT_MOCK: true,
}));

const {
  stageAndCommitCycle,
  formatCycleCommitMessage,
} = await import("../src/core/audit/git.js");

beforeEach(async () => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(TEST_ROOT, { recursive: true });
  await execFileP("git", ["-C", TEST_ROOT, "init", "--initial-branch=main"]);
  await execFileP("git", ["-C", TEST_ROOT, "config", "--local", "commit.gpgsign", "false"]);
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

const emptyReport = {
  kind: "nightly" as const,
  cycleId: "abc123",
  durationMs: 42_000,
  llmProvider: "claude-cli",
  createdSkills: [],
  editedSkills: [],
  mergedSkills: [],
  prunedSkills: [],
};

describe("formatCycleCommitMessage", () => {
  it("renders a compact subject with just created skills", () => {
    const msg = formatCycleCommitMessage({
      ...emptyReport,
      createdSkills: [
        { name: "a", description: "first" },
        { name: "b", description: "second" },
      ],
    });
    expect(msg.split("\n")[0]).toMatch(/^cycle\(nightly\): \+2 skills$/);
    expect(msg).toContain("Created:\n- a: first\n- b: second");
    expect(msg).toContain("LLM: claude-cli | duration: 42.0s | cycle-id: abc123");
  });

  it("includes merge + prune topics in subject", () => {
    const msg = formatCycleCommitMessage({
      ...emptyReport,
      createdSkills: [{ name: "x" }],
      mergedSkills: [{ from: ["a", "b"], into: "ab" }],
      prunedSkills: [{ name: "stale", reason: "low score" }],
    });
    const subj = msg.split("\n")[0]!;
    expect(subj).toContain("+1 skills");
    expect(subj).toContain("merged 1");
    expect(subj).toContain("pruned 1");
    expect(subj).toContain("merged: ab");
    expect(subj).toContain("pruned: stale");
  });

  it("humanizes subsecond and multi-minute durations", () => {
    const fast = formatCycleCommitMessage({ ...emptyReport, durationMs: 123 });
    expect(fast).toContain("duration: 123ms");
    const slow = formatCycleCommitMessage({ ...emptyReport, durationMs: 185_000 });
    expect(slow).toContain("duration: 3m5s");
  });
});

describe("stageAndCommitCycle", () => {
  it("returns null when nothing under skills/ or drafts/ changed", async () => {
    const result = await stageAndCommitCycle({
      ...emptyReport,
      createdSkills: [{ name: "a", description: "x" }],
    });
    expect(result).toBeNull();
  });

  it("commits and returns sha when a skill was created", async () => {
    const skillsDir = join(TEST_ROOT, "skills", "demo");
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(
      join(skillsDir, "SKILL.md"),
      `---\nname: demo\ndescription: test\norigin: auto-created\n---\n\nbody\n`
    );
    const result = await stageAndCommitCycle({
      ...emptyReport,
      createdSkills: [{ name: "demo", description: "test" }],
    });
    expect(result).not.toBeNull();
    expect(result!.sha).toMatch(/^[0-9a-f]{40}$/);

    const log = await execFileP("git", ["-C", TEST_ROOT, "log", "-1", "--pretty=%s"]);
    expect(log.stdout.trim()).toMatch(/^cycle\(nightly\): \+1 skills$/);
  });

  it("sets git identity if not configured", async () => {
    // Fresh repo — beforeEach already ran `git init`. Intentionally don't set user.name.
    const skillsDir = join(TEST_ROOT, "skills", "id");
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(
      join(skillsDir, "SKILL.md"),
      `---\nname: id\ndescription: test\n---\n\nbody\n`
    );
    await stageAndCommitCycle({
      ...emptyReport,
      createdSkills: [{ name: "id" }],
    });
    const name = await execFileP("git", ["-C", TEST_ROOT, "config", "--local", "user.name"]);
    expect(name.stdout.trim()).toBe("skillset");
  });

  it("is a no-op when .git doesn't exist", async () => {
    rmSync(join(TEST_ROOT, ".git"), { recursive: true, force: true });
    expect(existsSync(join(TEST_ROOT, ".git"))).toBe(false);
    const result = await stageAndCommitCycle(emptyReport);
    expect(result).toBeNull();
  });
});
