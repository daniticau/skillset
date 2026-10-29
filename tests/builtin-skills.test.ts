import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(tmpdir(), `skillset-builtin-test-${process.pid}`);
const STORE = join(ROOT, "store");
const SKILLS = join(STORE, "skills");

vi.mock("../src/core/paths.js", () => ({
  STORE_ROOT: STORE,
  STORE_SKILLS_DIR: SKILLS,
  CONFLICTS_DIR: join(STORE, "conflicts"),
  CONFIG_FILE: join(STORE, "config.json"),
  STATE_FILE: join(STORE, "state.json"),
  DEFAULT_CLAUDE_SKILLS_DIR: join(ROOT, "claude-skills"),
  DEFAULT_CODEX_SKILLS_DIR: join(ROOT, "codex-skills"),
  DEFAULT_KIMI_SKILLS_DIR: join(ROOT, "kimi-skills"),
  DEFAULT_CURSOR_SKILLS_DIR: join(ROOT, "cursor"),
  DEFAULT_AGENTS_SKILLS_DIR: join(ROOT, "agents"),
}));

const { parseSkillMd } = await import("../src/core/skill.js");
const { ensureBuiltinSkills, BUILTIN_SKILLS } = await import("../src/core/builtin-skills.js");

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(SKILLS, { recursive: true });
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe("built-in skills", () => {
  it("installs skillify and skillset-cli with their supporting files", async () => {
    const installed = await ensureBuiltinSkills();
    expect(installed.map((s) => s.name)).toEqual([...BUILTIN_SKILLS]);

    for (const name of BUILTIN_SKILLS) {
      const parsed = parseSkillMd(readFileSync(join(SKILLS, name, "SKILL.md"), "utf8"));
      expect(parsed.frontmatter.name).toBe(name);
      expect(parsed.body).not.toMatch(/sks tailor|--managed|sks build/);
    }
    expect(existsSync(join(SKILLS, "skillify", "references", "authoring.md"))).toBe(true);
  });

  it("keeps a user's copy and replaces an out-of-date built-in one", async () => {
    mkdirSync(join(SKILLS, "skillify"), { recursive: true });
    writeFileSync(join(SKILLS, "skillify", "SKILL.md"), "---\nname: skillify\ndescription: custom\n---\n\ncustom body\n");
    mkdirSync(join(SKILLS, "skillset-cli"), { recursive: true });
    writeFileSync(join(SKILLS, "skillset-cli", "SKILL.md"), "---\nname: skillset-cli\ndescription: old\n---\n\nRun sks tailor --stdin.\n");

    const installed = await ensureBuiltinSkills();
    expect(installed.map((s) => s.name)).toEqual(["skillset-cli"]);
    expect(readFileSync(join(SKILLS, "skillify", "SKILL.md"), "utf8")).toContain("custom body");
    expect(readFileSync(join(SKILLS, "skillset-cli", "SKILL.md"), "utf8")).not.toContain("sks tailor");
  });
});
