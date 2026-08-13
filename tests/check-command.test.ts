import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(tmpdir(), `skillset-check-command-${process.pid}`);
const STORE = join(ROOT, "store");
const SKILLS = join(STORE, "skills");

vi.mock("../src/core/paths.js", () => ({
  STORE_ROOT: STORE,
  STORE_SKILLS_DIR: SKILLS,
  SESSIONS_DIR: join(STORE, "sessions"),
  USAGE_DIR: join(STORE, "usage"),
  USAGE_EVENTS_FILE: join(STORE, "usage", "events.jsonl"),
  CONFLICTS_DIR: join(STORE, "conflicts"),
  CONFIG_FILE: join(STORE, "config.json"),
  STATE_FILE: join(STORE, "state.json"),
  DEFAULT_CLAUDE_SKILLS_DIR: join(ROOT, "claude-skills"),
  DEFAULT_CODEX_SKILLS_DIR: join(ROOT, "codex-skills"),
  DEFAULT_KIMI_SKILLS_DIR: join(ROOT, "kimi-skills"),
  DEFAULT_CURSOR_SKILLS_DIR: join(ROOT, "cursor"),
  DEFAULT_AGENTS_SKILLS_DIR: join(ROOT, "agents"),
  LEGACY_CODEX_SKILLS_DIR: join(ROOT, "legacy-codex-skills"),
}));

const { inspectSkills } = await import("../src/commands/check.js");

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(SKILLS, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(ROOT, { recursive: true, force: true });
});

function writeSkill(folder: string, source: string): void {
  const dir = join(SKILLS, folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), source);
}

describe("skill checks", () => {
  it("accepts a concise trigger-first skill", async () => {
    writeSkill(
      "focused-tests",
      "---\nname: focused-tests\ndescription: Use when validating a narrow code change.\n---\n\nRun focused tests first.\n"
    );

    const result = await inspectSkills();

    expect(result).toMatchObject({ checked: 1, valid: 1, errors: 0, warnings: 0 });
  });

  it("reports folder mismatches, weak discovery metadata, and empty bodies", async () => {
    writeSkill(
      "wrong-folder",
      "---\nname: another-name\ndescription: A generic helper.\n---\n\n"
    );

    const result = await inspectSkills();

    expect(result.errors).toBe(2);
    expect(result.warnings).toBe(1);
    expect(result.issues.map((issue) => issue.message).join("\n")).toContain("folder name");
  });

  it("flags nested SKILL.md files outside canonical skill roots", async () => {
    const nested = join(SKILLS, "package", "skills", "nested");
    mkdirSync(nested, { recursive: true });
    writeFileSync(
      join(nested, "SKILL.md"),
      "---\nname: nested\ndescription: Use when nested.\n---\n\nDo the thing.\n"
    );

    const result = await inspectSkills();

    expect(result.checked).toBe(0);
    expect(result.warnings).toBe(1);
    expect(result.issues[0]?.message).toContain("unmanaged nested skill file");
  });

  it("reports broken bundled-resource links", async () => {
    writeSkill(
      "broken-reference",
      "---\nname: broken-reference\ndescription: Use when checking bundled resources.\n---\n\nRead `references/missing.md` before acting.\n"
    );

    const result = await inspectSkills();

    expect(result.errors).toBe(1);
    expect(result.issues[0]?.message).toContain("referenced resource does not exist");
  });
});
