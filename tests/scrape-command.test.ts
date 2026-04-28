import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(tmpdir(), `skillset-scrape-command-${process.pid}`);
const STORE = join(ROOT, "store");
const SESSIONS = join(STORE, "sessions");
const STATE = join(STORE, "state.json");

const mocks = vi.hoisted(() => ({
  scrapeAll: vi.fn(),
}));

vi.mock("../src/core/paths.js", () => ({
  STORE_ROOT: STORE,
  STORE_SKILLS_DIR: join(STORE, "skills"),
  SESSIONS_DIR: SESSIONS,
  USAGE_DIR: join(STORE, "usage"),
  USAGE_EVENTS_FILE: join(STORE, "usage", "events.jsonl"),
  CONFLICTS_DIR: join(STORE, "conflicts"),
  CONFIG_FILE: join(STORE, "config.json"),
  STATE_FILE: STATE,
  DEFAULT_CLAUDE_SKILLS_DIR: join(ROOT, "claude-skills"),
  DEFAULT_CODEX_SKILLS_DIR: join(ROOT, "codex-skills"),
}));

vi.mock("../src/ingest/sessions/index.js", () => ({
  scrapeAll: mocks.scrapeAll,
}));

const { scrapeCommand, runScrape } = await import("../src/commands/scrape.js");
const { writeState, readState } = await import("../src/core/config.js");

beforeEach(async () => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(STORE, { recursive: true });
  await writeState({ version: 2, skills: {}, reviewedDates: {} });
  mocks.scrapeAll.mockReset();
  mocks.scrapeAll.mockResolvedValue({
    summary: {
      perSource: [
        { source: "claude-code", available: true, sessionsWritten: 2, sessionsSkipped: 1 },
        { source: "codex", available: false, sessionsWritten: 0, sessionsSkipped: 0, reason: "~/.codex not found" },
      ],
      totalMs: 1200,
    },
    nextCursors: { claudeCode: { files: { a: 1 } }, codex: { lastUpdatedAt: "2026-04-22T00:00:00.000Z" } },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(ROOT, { recursive: true, force: true });
});

describe("scrapeCommand", () => {
  it("scrapes all sources by default, prints a summary, and persists cursors", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await scrapeCommand({});

    expect(mocks.scrapeAll).toHaveBeenCalledWith(SESSIONS, {}, {});
    const state = await readState();
    expect(state.scrape?.codex?.lastUpdatedAt).toBe("2026-04-22T00:00:00.000Z");
    const output = logSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(output).toContain("scraping transcripts");
    expect(output).toContain("claude-code");
    expect(output).toContain("2 written");
    expect(output).toContain("~/.codex not found");
    expect(output).toContain("2 sessions");
  });

  it("passes source and full options through to the scraper", async () => {
    await runScrape({ source: "codex", full: true, quiet: true });

    expect(mocks.scrapeAll).toHaveBeenCalledWith(SESSIONS, {}, {
      source: "codex",
      full: true,
    });
  });

  it("merges new cursors with existing state", async () => {
    await writeState({
      version: 2,
      skills: {},
      reviewedDates: {},
      scrape: { cursor: { lastUpdatedAtByComposer: { c1: 123 } } },
    });

    await runScrape({ source: "claude-code", quiet: true });

    const raw = JSON.parse(readFileSync(STATE, "utf8")) as {
      scrape?: Record<string, unknown>;
    };
    expect(raw.scrape).toMatchObject({
      claudeCode: { files: { a: 1 } },
      codex: { lastUpdatedAt: "2026-04-22T00:00:00.000Z" },
    });
  });
});
