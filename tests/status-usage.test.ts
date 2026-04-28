import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(tmpdir(), `skillset-status-usage-${process.pid}`);
const STORE = join(ROOT, "store");
const SKILLS = join(STORE, "skills");
const USAGE = join(STORE, "usage");
const EVENTS = join(USAGE, "events.jsonl");

vi.mock("../src/core/paths.js", () => ({
  STORE_ROOT: STORE,
  STORE_SKILLS_DIR: SKILLS,
  SESSIONS_DIR: join(STORE, "sessions"),
  USAGE_DIR: USAGE,
  USAGE_EVENTS_FILE: EVENTS,
  CONFLICTS_DIR: join(STORE, "conflicts"),
  CONFIG_FILE: join(STORE, "config.json"),
  STATE_FILE: join(STORE, "state.json"),
  DEFAULT_CLAUDE_SKILLS_DIR: join(ROOT, "claude-skills"),
  DEFAULT_CODEX_SKILLS_DIR: join(ROOT, "codex-skills"),
}));

const { statusCommand } = await import("../src/commands/status.js");
const { appendUsageEvents, createExplicitUsageEvent } = await import("../src/usage/events.js");
const { writeConfig, writeState } = await import("../src/core/config.js");

beforeEach(async () => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(SKILLS, { recursive: true });
  await writeConfig({ version: 1, links: [] });
  await writeState({ version: 2, skills: {}, reviewedDates: {} });

  mkdirSync(join(SKILLS, "alpha"), { recursive: true });
  writeFileSync(
    join(SKILLS, "alpha", "SKILL.md"),
    "---\nname: alpha\ndescription: alpha\n---\n\nalpha body\n"
  );
  await appendUsageEvents([
    createExplicitUsageEvent({
      skillName: "alpha",
      agent: "codex",
      usedAt: "2026-04-23T09:00:00.000Z",
    }),
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(ROOT, { recursive: true, force: true });
});

describe("status --usage", () => {
  it("prints observed usage counts and last-used dates", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await statusCommand({ usage: true });

    const output = logSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(output).toContain("alpha");
    expect(output).toContain("1 use");
    expect(output).toContain("last 2026-04-23");
  });
});
