import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(tmpdir(), `skillset-builtin-test-${process.pid}`);
const STORE = join(ROOT, "store");
const SKILLS = join(STORE, "skills");

vi.mock("../src/core/paths.js", () => ({
  STORE_ROOT: STORE,
  STORE_SKILLS_DIR: SKILLS,
  SESSIONS_DIR: join(STORE, "sessions"),
  CONFLICTS_DIR: join(STORE, "conflicts"),
  CONFIG_FILE: join(STORE, "config.json"),
  STATE_FILE: join(STORE, "state.json"),
  DEFAULT_CLAUDE_SKILLS_DIR: join(ROOT, "claude-skills"),
  DEFAULT_CODEX_SKILLS_DIR: join(ROOT, "codex-skills"),
  DEFAULT_KIMI_SKILLS_DIR: join(ROOT, "kimi-skills"),
  DEFAULT_CURSOR_SKILLS_DIR: join(ROOT, "cursor"),
}));

const { parseSkillMd } = await import("../src/core/skill.js");
const { ensureBuiltinSkills, SKILL_THIS_NAME, SKILLSET_CLI_NAME } = await import("../src/core/builtin-skills.js");

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(SKILLS, { recursive: true });
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe("built-in skills", () => {
  it("installs the skill-this trigger skill into the canonical store", async () => {
    const installed = await ensureBuiltinSkills();
    expect(installed.map((s) => s.name)).toEqual([SKILL_THIS_NAME, SKILLSET_CLI_NAME]);

    const raw = readFileSync(join(SKILLS, SKILL_THIS_NAME, "SKILL.md"), "utf8");
    const parsed = parseSkillMd(raw);
    expect(parsed.frontmatter).toMatchObject({
      name: SKILL_THIS_NAME,
      tier: "medium",
      origin: "user-created",
    });
    expect(parsed.body).toContain("sks tailor --stdin");

    const cliRaw = readFileSync(join(SKILLS, SKILLSET_CLI_NAME, "SKILL.md"), "utf8");
    const cliSkill = parseSkillMd(cliRaw);
    expect(cliSkill.frontmatter.description).toContain("connected coding harness");
    expect(cliSkill.body).toContain("sks edit <skill> --stdin");
    expect(cliSkill.body).toContain("--managed");
  });

  it("does not overwrite an existing user copy", async () => {
    const dir = join(SKILLS, SKILL_THIS_NAME);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "SKILL.md"),
      "---\nname: skill-this\ndescription: custom\n---\n\ncustom body\n"
    );

    const installed = await ensureBuiltinSkills();
    expect(installed.map((s) => s.name)).toEqual([SKILLSET_CLI_NAME]);
    expect(readFileSync(join(dir, "SKILL.md"), "utf8")).toContain("custom body");
  });
});
