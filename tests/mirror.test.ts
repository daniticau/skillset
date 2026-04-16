import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_ROOT = join(tmpdir(), "skillset-test-fixed");
const STORE = join(TEST_ROOT, "store");
const SKILLS = join(STORE, "skills");
const MIRROR = join(TEST_ROOT, "mirror");

vi.mock("../src/core/paths.js", () => ({
  STORE_ROOT: STORE,
  STORE_SKILLS_DIR: SKILLS,
  CONFIG_FILE: join(STORE, "config.json"),
  STATE_FILE: join(STORE, "state.json"),
  DEFAULT_CLAUDE_SKILLS_DIR: MIRROR,
}));

// eager imports so the mocked paths module is loaded once
const { writeConfig } = await import("../src/core/config.js");
const { sync } = await import("../src/core/mirror.js");

function makeSkill(root: string, name: string, body: string) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Test skill for ${name}.\n---\n\n${body}\n`
  );
}

beforeEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(SKILLS, { recursive: true });
  mkdirSync(MIRROR, { recursive: true });
});

describe("mirror sync", () => {
  it("copies canonical skills to mirror on first sync", async () => {
    await writeConfig({ version: 1, links: [{ agent: "claude-code", path: MIRROR }] });
    makeSkill(SKILLS, "alpha", "alpha body");

    const report = await sync();
    expect(report.skillCount).toBe(1);
    expect(readFileSync(join(MIRROR, "alpha", "SKILL.md"), "utf8")).toContain("alpha body");
  });

  it("promotes user edits in the mirror back to canonical", async () => {
    await writeConfig({ version: 1, links: [{ agent: "claude-code", path: MIRROR }] });
    makeSkill(SKILLS, "beta", "original body");
    await sync();

    writeFileSync(
      join(MIRROR, "beta", "SKILL.md"),
      `---\nname: beta\ndescription: Test skill for beta.\n---\n\nedited body\n`
    );

    const report = await sync();
    const promoted = report.actions.filter((a) => a.kind === "promoted");
    expect(promoted).toHaveLength(1);
    expect(readFileSync(join(SKILLS, "beta", "SKILL.md"), "utf8")).toContain("edited body");
  });

  it("adopts a skill that exists only in the mirror", async () => {
    await writeConfig({ version: 1, links: [{ agent: "claude-code", path: MIRROR }] });
    makeSkill(MIRROR, "gamma", "mirror-born body");

    const report = await sync();
    const adopted = report.actions.filter((a) => a.kind === "adopted");
    expect(adopted).toHaveLength(1);
    expect(readFileSync(join(SKILLS, "gamma", "SKILL.md"), "utf8")).toContain("mirror-born body");
  });
});
