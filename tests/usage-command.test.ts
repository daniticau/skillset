import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(tmpdir(), `skillset-usage-command-${process.pid}`);
const STORE = join(ROOT, "store");
const SKILLS = join(STORE, "skills");
const SESSIONS = join(STORE, "sessions");
const USAGE = join(STORE, "usage");
const EVENTS = join(USAGE, "events.jsonl");

vi.mock("../src/core/paths.js", () => ({
  STORE_ROOT: STORE,
  STORE_SKILLS_DIR: SKILLS,
  SESSIONS_DIR: SESSIONS,
  USAGE_DIR: USAGE,
  USAGE_EVENTS_FILE: EVENTS,
  CONFLICTS_DIR: join(STORE, "conflicts"),
  CONFIG_FILE: join(STORE, "config.json"),
  STATE_FILE: join(STORE, "state.json"),
  DEFAULT_CLAUDE_SKILLS_DIR: join(ROOT, "claude-skills"),
  DEFAULT_CODEX_SKILLS_DIR: join(ROOT, "codex-skills"),
}));

const { usageCommand, usageRecordCommand, usageScanCommand } = await import("../src/commands/usage.js");
const { readUsageEvents } = await import("../src/usage/events.js");
const { writeState } = await import("../src/core/config.js");

beforeEach(async () => {
  rmSync(ROOT, { recursive: true, force: true });
  process.exitCode = undefined;
  mkdirSync(SKILLS, { recursive: true });
  await writeState({ version: 2, skills: {}, reviewedDates: {} });
  makeSkill("alpha");
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(ROOT, { recursive: true, force: true });
});

function makeSkill(name: string): void {
  const dir = join(SKILLS, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name}\n---\n\n${name} body\n`
  );
}

function outputOf(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((args) => args.join(" ")).join("\n");
}

describe("usage command", () => {
  it("records explicit usage and prints summary plus timeline", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await usageRecordCommand("alpha", {
      agent: "codex",
      at: "2026-04-22T12:00:00.000Z",
      project: "skillset",
      evidence: "manual report",
    });

    const events = await readUsageEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      skillName: "alpha",
      agent: "codex",
      source: "explicit",
      confidence: 1,
    });

    await usageCommand();
    let output = outputOf(logSpy);
    expect(output).toContain("alpha");
    expect(output).toContain("1 use");
    expect(output).toContain("last 2026-04-22");

    logSpy.mockClear();
    await usageCommand("alpha");
    output = outputOf(logSpy);
    expect(output).toContain("Usage for alpha");
    expect(output).toContain("explicit");
    expect(output).toContain("manual report");
  });

  it("scans scraped sessions from the CLI command", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mkdirSync(join(SESSIONS, "codex"), { recursive: true });
    writeFileSync(
      join(SESSIONS, "codex", "s1.jsonl"),
      [
        JSON.stringify({
          source: "codex",
          sessionId: "s1",
          scrapedAt: "2026-04-22T12:00:00.000Z",
          raw: { type: "user_message", timestamp: "2026-04-22T12:00:00.000Z", content: "go" },
        }),
        JSON.stringify({
          source: "codex",
          sessionId: "s1",
          scrapedAt: "2026-04-22T12:00:00.000Z",
          raw: {
            type: "agent_message",
            timestamp: "2026-04-22T12:00:01.000Z",
            content: "I'm using the alpha skill now.",
          },
        }),
      ].join("\n") + "\n",
      "utf8"
    );

    await usageScanCommand({ noScrape: true });

    expect(await readUsageEvents()).toHaveLength(1);
    expect(outputOf(logSpy)).toContain("1 observed use");

    logSpy.mockClear();
    await usageScanCommand({ noScrape: true });

    expect(await readUsageEvents()).toHaveLength(1);
    expect(outputOf(logSpy)).toContain("0 observed uses");
    expect(outputOf(logSpy)).toContain("1 skipped");
  });

  it("rejects explicit records for unknown skills", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await usageRecordCommand("missing", {
      agent: "codex",
      at: "2026-04-22T12:00:00.000Z",
    });

    expect(process.exitCode).toBe(1);
    expect(await readUsageEvents()).toHaveLength(0);
    expect(outputOf(errorSpy)).toContain('unknown skill "missing"');
  });

  it("rejects invalid explicit usage dates without throwing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await usageRecordCommand("alpha", {
      agent: "codex",
      at: "not-a-date",
    });

    expect(process.exitCode).toBe(1);
    expect(await readUsageEvents()).toHaveLength(0);
    expect(outputOf(errorSpy)).toContain('invalid --at date "not-a-date"');
  });
});
