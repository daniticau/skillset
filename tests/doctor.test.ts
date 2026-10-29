import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_ROOT = join(tmpdir(), "skillset-doctor-fixed");
const STORE = join(TEST_ROOT, "store");
const SKILLS = join(STORE, "skills");
const CLAUDE_MIRROR = join(TEST_ROOT, "claude-mirror");
const CODEX_MIRROR = join(TEST_ROOT, "codex-mirror");

vi.mock("../src/core/paths.js", () => ({
  STORE_ROOT: STORE,
  STORE_SKILLS_DIR: SKILLS,
  SESSIONS_DIR: join(STORE, "sessions"),
  USAGE_DIR: join(STORE, "usage"),
  USAGE_EVENTS_FILE: join(STORE, "usage", "events.jsonl"),
  CONFLICTS_DIR: join(STORE, "conflicts"),
  CONFIG_FILE: join(STORE, "config.json"),
  STATE_FILE: join(STORE, "state.json"),
  DEFAULT_CLAUDE_SKILLS_DIR: CLAUDE_MIRROR,
  DEFAULT_CODEX_SKILLS_DIR: CODEX_MIRROR,
  DEFAULT_KIMI_SKILLS_DIR: join(TEST_ROOT, "kimi-mirror"),
  DEFAULT_CURSOR_SKILLS_DIR: join(TEST_ROOT, "cursor"),
  DEFAULT_AGENTS_SKILLS_DIR: join(TEST_ROOT, "agents"),
  LEGACY_CODEX_SKILLS_DIR: join(TEST_ROOT, "legacy-codex-skills"),
}));

const { writeConfig, writeState } = await import("../src/core/config.js");
const { doctorCommand } = await import("../src/commands/doctor.js");

describe("doctorCommand", () => {
  beforeEach(async () => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
    mkdirSync(SKILLS, { recursive: true });
    mkdirSync(CLAUDE_MIRROR, { recursive: true });
    mkdirSync(CODEX_MIRROR, { recursive: true });

    mkdirSync(join(CLAUDE_MIRROR, "alpha"), { recursive: true });
    writeFileSync(
      join(CLAUDE_MIRROR, "alpha", "SKILL.md"),
      "---\nname: alpha\ndescription: alpha\n---\n\nalpha body\n"
    );

    mkdirSync(join(CODEX_MIRROR, "gamma"), { recursive: true });
    writeFileSync(
      join(CODEX_MIRROR, "gamma", "SKILL.md"),
      "---\nname: gamma\ndescription: gamma\n---\n\ngamma body\n"
    );

    await writeConfig({
      version: 1,
      links: [
        { agent: "claude-code", path: CLAUDE_MIRROR },
        { agent: "codex", path: CODEX_MIRROR },
      ],
    });
    await writeState({ version: 2, skills: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it("reports mirror layouts for Claude and Codex links", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(doctorCommand()).resolves.toBeUndefined();

    const output = logSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(output).toContain("Claude Code");
    expect(output).toContain("Codex");
    expect(output).toContain("(1 skill)");
  });

  it("repairs by importing connected mirror skills into canonical", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await doctorCommand({ repair: true });

    const imported = join(SKILLS, "alpha", "SKILL.md");
    expect(existsSync(imported)).toBe(true);
    expect(readFileSync(imported, "utf8")).toContain("alpha body");
  });

});
