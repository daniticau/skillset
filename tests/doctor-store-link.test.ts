import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(tmpdir(), `skillset-doctor-link-${process.pid}`);
const STORE = join(ROOT, "store");
const SKILLS = join(STORE, "skills");
const OLD_TARGET = join(ROOT, "old", "SKILLS");
const NEW_TARGET = join(ROOT, "moved", "SKILLS");
const CLAUDE_SKILLS = join(ROOT, "claude", "skills");

vi.mock("../src/core/paths.js", () => ({
  STORE_ROOT: STORE,
  STORE_SKILLS_DIR: SKILLS,
  SESSIONS_DIR: join(STORE, "sessions"),
  USAGE_DIR: join(STORE, "usage"),
  USAGE_EVENTS_FILE: join(STORE, "usage", "events.jsonl"),
  CONFLICTS_DIR: join(STORE, "conflicts"),
  REPORTS_DIR: join(STORE, "reports"),
  CONFIG_FILE: join(STORE, "config.json"),
  STATE_FILE: join(STORE, "state.json"),
  DEFAULT_CLAUDE_SKILLS_DIR: CLAUDE_SKILLS,
  DEFAULT_CODEX_SKILLS_DIR: join(ROOT, "codex", "skills"),
  DEFAULT_KIMI_SKILLS_DIR: join(ROOT, "kimi", "skills"),
  DEFAULT_GROK_SKILLS_DIR: join(ROOT, "grok", "skills"),
  DEFAULT_CURSOR_SKILLS_DIR: join(ROOT, "cursor"),
  DEFAULT_AGENTS_SKILLS_DIR: join(ROOT, "agents"),
  LEGACY_CODEX_SKILLS_DIR: join(ROOT, "legacy"),
}));

vi.mock("../src/llm/index.js", () => ({
  defaultLLMConfig: () => ({ provider: "grok-cli", model: "x", embeddingModel: undefined }),
  isAvailable: async () => ({ reachable: true, modelPresent: true, models: [] }),
}));

const { writeConfig } = await import("../src/core/config.js");
const { sync } = await import("../src/core/mirror.js");
const { doctorCommand } = await import("../src/commands/doctor.js");

let logs: string[] = [];

beforeEach(async () => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(STORE, { recursive: true });
  mkdirSync(join(OLD_TARGET, "alpha"), { recursive: true });
  writeFileSync(join(OLD_TARGET, "alpha", "SKILL.md"), "---\nname: alpha\ndescription: Use when a.\n---\n\nalpha body\n");
  symlinkSync(OLD_TARGET, SKILLS);
  mkdirSync(CLAUDE_SKILLS, { recursive: true });
  await writeConfig({ version: 1, links: [{ agent: "claude-code", path: CLAUDE_SKILLS }] });
  logs = [];
  process.exitCode = undefined;
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
  rmSync(ROOT, { recursive: true, force: true });
});

/** Simulate the user moving the folder the store links to. */
function moveStoreTarget(): void {
  mkdirSync(join(ROOT, "moved"), { recursive: true });
  rmSync(NEW_TARGET, { recursive: true, force: true });
  // rename would be cleaner, but keep it explicit: copy then delete.
  mkdirSync(join(NEW_TARGET, "alpha"), { recursive: true });
  writeFileSync(join(NEW_TARGET, "alpha", "SKILL.md"), "---\nname: alpha\ndescription: Use when a.\n---\n\nalpha body\n");
  rmSync(OLD_TARGET, { recursive: true, force: true });
}

describe("doctor and a moved store", () => {
  it("reports a dangling skills link", async () => {
    await sync();
    moveStoreTarget();
    await doctorCommand();
    const line = logs.find((l) => l.includes("skills") && l.includes(OLD_TARGET));
    expect(line).toBeDefined();
    expect(line).toContain("target missing");
  });

  it("refuses to prune mirrors through a dangling link", async () => {
    await sync();
    expect(existsSync(join(CLAUDE_SKILLS, "alpha", "SKILL.md"))).toBe(true);
    moveStoreTarget();
    await expect(sync()).rejects.toThrow(/refusing to sync/);
    expect(existsSync(join(CLAUDE_SKILLS, "alpha", "SKILL.md"))).toBe(true);
  });

  it("relinks with --repair --store and then syncs normally", async () => {
    await sync();
    moveStoreTarget();
    await doctorCommand({ repair: true, store: NEW_TARGET });
    expect(readlinkSync(SKILLS)).toBe(NEW_TARGET);
    expect(logs.some((l) => l.includes("relinked"))).toBe(true);
    expect(process.exitCode).toBeUndefined();
    expect(existsSync(join(CLAUDE_SKILLS, "alpha", "SKILL.md"))).toBe(true);
  });

  it("rejects --store without --repair, and a --store that is not a folder", async () => {
    await doctorCommand({ store: NEW_TARGET });
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    moveStoreTarget();
    await doctorCommand({ repair: true, store: join(ROOT, "nope") });
    expect(process.exitCode).toBe(1);
    expect(readlinkSync(SKILLS)).toBe(OLD_TARGET);
  });
});
