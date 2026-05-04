import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(tmpdir(), `skillset-codex-test-${process.pid}`);
const MIRROR = join(ROOT, ".codex", "skills");
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
  DEFAULT_CODEX_SKILLS_DIR: MIRROR,
}));

const { codexAdapter } = await import("../src/core/adapters/codex.js");

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(MIRROR, { recursive: true });
  mkdirSync(SKILLS, { recursive: true });
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe("codex skills adapter", () => {
  it("mirrors a SKILL.md directory into the Codex user skills root", async () => {
    const canonical = join(SKILLS, "alpha");
    mkdirSync(canonical, { recursive: true });
    writeFileSync(
      join(canonical, "SKILL.md"),
      "---\nname: alpha\ndescription: a\n---\n\nalpha body\n"
    );

    await codexAdapter.mirrorSkill!(
      { frontmatter: { name: "alpha", description: "a" }, body: "alpha body" },
      MIRROR
    );

    const raw = readFileSync(join(MIRROR, "alpha", "SKILL.md"), "utf8");
    expect(raw).toContain("alpha body");
  });

  it("uses the per-skill-dir layout so user edits can be promoted", async () => {
    expect(codexAdapter.layout).toBe("per-skill-dir");
    expect(codexAdapter.defaultPath).toContain(join(".codex", "skills"));
    expect(codexAdapter.listMirrorSkills).toBeDefined();
    expect(codexAdapter.readMirrorSkill).toBeDefined();
  });

  it("lists and reads existing Codex skills", async () => {
    mkdirSync(join(MIRROR, "beta"), { recursive: true });
    writeFileSync(
      join(MIRROR, "beta", "SKILL.md"),
      "---\nname: beta\ndescription: b\n---\n\nbeta body\n"
    );

    await expect(codexAdapter.listMirrorSkills!(MIRROR)).resolves.toEqual(["beta"]);
    const parsed = await codexAdapter.readMirrorSkill!("beta", MIRROR);
    expect(parsed?.body).toContain("beta body");
  });
});
