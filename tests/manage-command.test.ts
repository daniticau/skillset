import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(tmpdir(), `skillset-manage-command-${process.pid}`);
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

const { addCommand, editCommand, showCommand } = await import("../src/commands/manage.js");
const { readState } = await import("../src/core/config.js");

const RAW = `---
name: test-skill
description: Use when testing deterministic skill management.
tier: medium
---

# Test Skill

Run the exact test requested.
`;

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(SKILLS, { recursive: true });
  process.exitCode = undefined;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
  rmSync(ROOT, { recursive: true, force: true });
});

describe("agent-safe skill management", () => {
  it("adds a complete SKILL.md from provided stdin content and records user ownership", async () => {
    await addCommand(undefined, { content: RAW });

    const path = join(SKILLS, "test-skill", "SKILL.md");
    expect(readFileSync(path, "utf8")).toContain("origin: user-created");
    expect((await readState()).skills["test-skill"]).toMatchObject({
      origin: "user-created",
      createdBy: "manual",
    });
  });

  it("marks agent-created additions as managed when explicitly requested", async () => {
    await addCommand(undefined, { content: RAW, managed: true });

    const path = join(SKILLS, "test-skill", "SKILL.md");
    expect(readFileSync(path, "utf8")).toContain("origin: auto-created");
    expect((await readState()).skills["test-skill"]).toMatchObject({
      origin: "auto-created",
      createdBy: "agent",
      userEdited: false,
    });

    await editCommand("test-skill", {
      content: RAW.replace("Run the exact test requested.", "Run focused tests first."),
      managed: true,
    });
    expect((await readState()).skills["test-skill"]?.userEdited).toBe(false);
  });

  it("copies supporting files when adding a skill directory", async () => {
    const source = join(ROOT, "source", "test-skill");
    mkdirSync(join(source, "references"), { recursive: true });
    writeFileSync(join(source, "SKILL.md"), RAW);
    writeFileSync(join(source, "references", "notes.md"), "details\n");
    mkdirSync(join(source, ".git"), { recursive: true });
    writeFileSync(join(source, ".git", "config"), "should not copy\n");
    mkdirSync(join(source, "scripts", "__pycache__"), { recursive: true });
    writeFileSync(join(source, "scripts", "__pycache__", "cache.pyc"), "junk\n");

    await addCommand(source);

    expect(existsSync(join(SKILLS, "test-skill", "references", "notes.md"))).toBe(true);
    expect(existsSync(join(SKILLS, "test-skill", ".git"))).toBe(false);
    expect(existsSync(join(SKILLS, "test-skill", "scripts", "__pycache__"))).toBe(false);
  });

  it("refuses to overwrite a same-name skill that has not been adopted from a mirror", async () => {
    const mirrorSkill = join(ROOT, "codex-skills", "test-skill");
    mkdirSync(mirrorSkill, { recursive: true });
    writeFileSync(join(mirrorSkill, "SKILL.md"), RAW);
    mkdirSync(STORE, { recursive: true });
    writeFileSync(
      join(STORE, "config.json"),
      JSON.stringify({
        version: 1,
        links: [{ agent: "codex", path: join(ROOT, "codex-skills") }],
      })
    );

    await addCommand(undefined, { content: RAW });

    expect(process.exitCode).toBe(1);
    expect(existsSync(join(SKILLS, "test-skill"))).toBe(false);
  });

  it("updates an existing skill non-interactively, preserves ownership, and marks the edit", async () => {
    await addCommand(undefined, { content: RAW });
    const replacement = RAW.replace("Run the exact test requested.", "Run focused tests first.");

    await editCommand("test-skill", { content: replacement });

    const path = join(SKILLS, "test-skill", "SKILL.md");
    expect(readFileSync(path, "utf8")).toContain("Run focused tests first.");
    expect(readFileSync(path, "utf8")).toContain("origin: user-created");
    expect((await readState()).skills["test-skill"]?.userEdited).toBe(true);
  });

  it("replaces a complete skill directory so supporting files can be revised", async () => {
    await addCommand(undefined, { content: RAW });
    const source = join(ROOT, "revision", "test-skill");
    mkdirSync(join(source, "references"), { recursive: true });
    writeFileSync(
      join(source, "SKILL.md"),
      RAW.replace("Run the exact test requested.", "Read references/guide.md when needed.")
    );
    writeFileSync(join(source, "references", "guide.md"), "focused details\n");

    await editCommand("test-skill", { source });

    expect(readFileSync(join(SKILLS, "test-skill", "SKILL.md"), "utf8")).toContain(
      "Read references/guide.md"
    );
    expect(readFileSync(join(SKILLS, "test-skill", "references", "guide.md"), "utf8")).toBe(
      "focused details\n"
    );
  });

  it("rejects a stdin edit that attempts to rename the skill", async () => {
    await addCommand(undefined, { content: RAW });
    const before = readFileSync(join(SKILLS, "test-skill", "SKILL.md"), "utf8");

    await editCommand("test-skill", { content: RAW.replace("name: test-skill", "name: renamed") });

    expect(process.exitCode).toBe(1);
    expect(readFileSync(join(SKILLS, "test-skill", "SKILL.md"), "utf8")).toBe(before);
  });

  it("lets a complete Markdown edit remove obsolete tier metadata", async () => {
    await addCommand(undefined, { content: RAW });

    await editCommand("test-skill", { content: RAW.replace("tier: medium\n", "") });

    expect(readFileSync(join(SKILLS, "test-skill", "SKILL.md"), "utf8")).not.toContain("tier:");
  });

  it("shows raw or machine-readable canonical content", async () => {
    await addCommand(undefined, { content: RAW });
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await showCommand("test-skill");

    expect(write).toHaveBeenCalledWith(expect.stringContaining("name: test-skill"));
  });
});
