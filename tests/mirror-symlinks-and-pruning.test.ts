import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_ROOT = join(tmpdir(), "skillset-dataloss-proof");
const STORE = join(TEST_ROOT, "store");
const SKILLS = join(STORE, "skills");
const MIRROR = join(TEST_ROOT, "claude-mirror");

vi.mock("../src/core/paths.js", () => ({
  STORE_ROOT: STORE,
  STORE_SKILLS_DIR: SKILLS,
  CONFLICTS_DIR: join(STORE, "conflicts"),
  CONFIG_FILE: join(STORE, "config.json"),
  STATE_FILE: join(STORE, "state.json"),
  DEFAULT_CLAUDE_SKILLS_DIR: MIRROR,
  DEFAULT_CODEX_SKILLS_DIR: join(TEST_ROOT, "codex-mirror"),
  DEFAULT_KIMI_SKILLS_DIR: join(TEST_ROOT, "kimi-mirror"),
  DEFAULT_GROK_SKILLS_DIR: join(TEST_ROOT, "grok-mirror"),
  DEFAULT_CURSOR_SKILLS_DIR: join(TEST_ROOT, "cursor"),
  DEFAULT_AGENTS_SKILLS_DIR: join(TEST_ROOT, "agents"),
  LEGACY_CODEX_SKILLS_DIR: join(TEST_ROOT, "legacy-codex"),
  SESSIONS_DIR: join(STORE, "sessions"),
  USAGE_DIR: join(STORE, "usage"),
  USAGE_EVENTS_FILE: join(STORE, "usage", "events.jsonl"),
  REPORTS_DIR: join(STORE, "reports"),
}));

const { writeConfig } = await import("../src/core/config.js");
const { sync } = await import("../src/core/mirror.js");

function skillMd(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: Use when testing ${name} behaviour in the mirror pipeline.\n---\n\n${body}\n`;
}

function writeSkill(root: string, name: string, body: string) {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, "SKILL.md"), skillMd(name, body), "utf8");
}

beforeEach(async () => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(SKILLS, { recursive: true });
  mkdirSync(MIRROR, { recursive: true });
  await writeConfig({ version: 1, links: [{ agent: "claude-code", path: MIRROR }] });
});

afterEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe("BUG 1: remove prunes unrelated third-party mirror skills", () => {
  it("deletes a hand-installed mirror skill when an unrelated skill is removed", async () => {
    writeSkill(SKILLS, "owned-skill", "canonical body");
    await sync();

    // User installs a third-party skill straight into the agent's dir
    // (the normal way people install skills), between syncs.
    writeSkill(MIRROR, "insforge", "third party body");
    expect(existsSync(join(MIRROR, "insforge", "SKILL.md"))).toBe(true);

    // `sks remove` runs sync with adoption disabled.
    rmSync(join(SKILLS, "owned-skill"), { recursive: true, force: true });
    await sync({ adoptUntracked: false });

    // The third-party skill is unrelated to what was removed.
    expect(existsSync(join(MIRROR, "insforge", "SKILL.md"))).toBe(true);
  });
});

describe("symlinked skills are first-class", () => {
  it("adopts a symlinked mirror skill into canonical and out to other agents", async () => {
    writeSkill(SKILLS, "owned-skill", "canonical body");
    await sync();

    // Installing a skill by symlinking it into the agent's skills dir is a
    // normal workflow (keeps the source in its own repo).
    const external = join(TEST_ROOT, "external", "linked-skill");
    mkdirSync(external, { recursive: true });
    writeFileSync(join(external, "SKILL.md"), skillMd("linked-skill", "linked body"), "utf8");
    symlinkSync(external, join(MIRROR, "linked-skill"), "dir");

    await sync();

    expect(existsSync(join(SKILLS, "linked-skill", "SKILL.md"))).toBe(true);
    expect(readFileSync(join(SKILLS, "linked-skill", "SKILL.md"), "utf8")).toContain("linked body");
  });

  it("counts a symlinked canonical skill and mirrors it", async () => {
    const external = join(TEST_ROOT, "external", "linked-canonical");
    mkdirSync(external, { recursive: true });
    writeFileSync(
      join(external, "SKILL.md"),
      skillMd("linked-canonical", "external canonical body"),
      "utf8"
    );
    symlinkSync(external, join(SKILLS, "linked-canonical"), "dir");

    const report = await sync();

    expect(report.skillCount).toBe(1);
    expect(existsSync(join(MIRROR, "linked-canonical", "SKILL.md"))).toBe(true);
  });
});

describe("BUG 2: promotion of a multi-file skill drops user-added files", () => {
  it("keeps a reference file the user added next to an edited mirror SKILL.md", async () => {
    mkdirSync(join(SKILLS, "multi"), { recursive: true });
    writeFileSync(join(SKILLS, "multi", "SKILL.md"), skillMd("multi", "v1"), "utf8");
    writeFileSync(join(SKILLS, "multi", "reference.md"), "canonical reference\n", "utf8");
    await sync();

    // User edits the skill in the mirror AND adds a supporting file.
    writeFileSync(join(MIRROR, "multi", "SKILL.md"), skillMd("multi", "v2 edited"), "utf8");
    writeFileSync(join(MIRROR, "multi", "notes.md"), "user added notes\n", "utf8");

    await sync();

    // The SKILL.md edit should be promoted...
    expect(readFileSync(join(SKILLS, "multi", "SKILL.md"), "utf8")).toContain("v2 edited");
    // ...and the file the user added alongside it should survive.
    expect(existsSync(join(MIRROR, "multi", "notes.md"))).toBe(true);
    expect(existsSync(join(SKILLS, "multi", "notes.md"))).toBe(true);
  });
});

describe("sync is crash-isolated", () => {
  it("reconciles healthy skills even when one skill is unreadable", async () => {
    writeSkill(SKILLS, "good-one", "fine");
    writeSkill(SKILLS, "bad-one", "also fine for now");
    await sync();

    // Corrupt one skill: frontmatter that fails to parse/validate.
    writeFileSync(join(SKILLS, "bad-one", "SKILL.md"), "no frontmatter at all\n", "utf8");
    writeSkill(SKILLS, "added-later", "should still reach the mirror");

    const report = await sync();

    // The broken skill is reported, not thrown...
    expect(report.failures.map((f) => f.skill)).toContain("bad-one");
    // ...and the rest of the pass still completed.
    expect(existsSync(join(MIRROR, "added-later", "SKILL.md"))).toBe(true);
    expect(existsSync(join(MIRROR, "good-one", "SKILL.md"))).toBe(true);
  });
});

describe("vendor skills that ship with an agent", () => {
  it("never adopts a vendor skill into the shared library", async () => {
    writeSkill(SKILLS, "owned-skill", "canonical body");
    await sync();

    // Stands in for Grok's bundled help/imagine/code-review.
    writeSkill(MIRROR, "vendor-builtin", "ships with the agent");

    const { getAdapter } = await import("../src/core/adapters/index.js");
    const adapter = getAdapter("claude-code");
    const original = adapter.vendorSkills;
    adapter.vendorSkills = async () => ["vendor-builtin"];

    try {
      await sync();
      // Not pulled into canonical...
      expect(existsSync(join(SKILLS, "vendor-builtin"))).toBe(false);
      // ...and not deleted from the agent that owns it.
      expect(existsSync(join(MIRROR, "vendor-builtin", "SKILL.md"))).toBe(true);
    } finally {
      adapter.vendorSkills = original;
    }
  });
});
