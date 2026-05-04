import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(tmpdir(), `skillset-usage-test-${process.pid}`);
const STORE = join(ROOT, "store");
const SKILLS = join(STORE, "skills");
const SESSIONS = join(STORE, "sessions");
const USAGE = join(STORE, "usage");
const EVENTS = join(USAGE, "events.jsonl");
const STATE = join(STORE, "state.json");

vi.mock("../src/core/paths.js", () => ({
  STORE_ROOT: STORE,
  STORE_SKILLS_DIR: SKILLS,
  SESSIONS_DIR: SESSIONS,
  USAGE_DIR: USAGE,
  USAGE_EVENTS_FILE: EVENTS,
  CONFLICTS_DIR: join(STORE, "conflicts"),
  CONFIG_FILE: join(STORE, "config.json"),
  STATE_FILE: STATE,
  DEFAULT_CLAUDE_SKILLS_DIR: join(ROOT, "claude-skills"),
  DEFAULT_CODEX_SKILLS_DIR: join(ROOT, "codex-skills"),
}));

const {
  appendUsageEvents,
  readUsageEvents,
  summarizeUsage,
  createExplicitUsageEvent,
} = await import("../src/usage/events.js");
const { scanUsageFromSessions } = await import("../src/usage/scan.js");
const { readState, writeState } = await import("../src/core/config.js");

beforeEach(async () => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(SKILLS, { recursive: true });
  await writeState({ version: 2, skills: {}, reviewedDates: {} });
});

afterAll(() => {
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

function writeEnvelope(
  source: "claude-code" | "codex",
  stem: string,
  records: unknown[],
  sessionId = stem
): void {
  const dir = join(SESSIONS, source);
  mkdirSync(dir, { recursive: true });
  const lines = records.map((raw) =>
    JSON.stringify({
      source,
      sessionId,
      scrapedAt: "2026-04-20T10:00:00.000Z",
      raw,
    })
  );
  writeFileSync(join(dir, `${stem}.jsonl`), lines.join("\n") + "\n", "utf8");
}

describe("usage events", () => {
  it("appends events idempotently and summarizes counts", async () => {
    const first = createExplicitUsageEvent({
      skillName: "alpha",
      agent: "codex",
      usedAt: "2026-04-20T12:00:00.000Z",
      project: "skillset",
    });
    const second = createExplicitUsageEvent({
      skillName: "alpha",
      agent: "claude-code",
      usedAt: "2026-04-21T12:00:00.000Z",
    });

    expect(await appendUsageEvents([first, first, second])).toEqual({
      added: 2,
      skipped: 1,
    });

    const events = await readUsageEvents();
    expect(events.map((e) => e.id)).toEqual([first.id, second.id]);
    expect(readFileSync(EVENTS, "utf8").trim().split("\n")).toHaveLength(2);

    const summaries = summarizeUsage(events);
    expect(summaries.get("alpha")).toMatchObject({
      skillName: "alpha",
      count: 2,
      explicitCount: 2,
      inferredCount: 0,
      lastUsedAt: "2026-04-21T12:00:00.000Z",
    });
  });

  it("infers native skill invocations and assistant announcements only for known skills", async () => {
    makeSkill("alpha");
    makeSkill("beta");

    writeEnvelope("claude-code", "proj__s1", [
      {
        type: "user",
        timestamp: "2026-04-20T09:00:00.000Z",
        message: { role: "user", content: "please work on this" },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              name: "Skill",
              input: { skill: "alpha" },
            },
          ],
        },
      },
    ], "s1");

    writeEnvelope("codex", "s2", [
      { type: "user_message", timestamp: "2026-04-21T09:00:00.000Z", content: "go" },
      {
        type: "agent_message",
        timestamp: "2026-04-21T09:01:00.000Z",
        content: [
          {
            type: "output_text",
            text: "I'm using the beta skill to keep this consistent. I am also using the gamma skill.",
          },
        ],
      },
    ], "s2");

    const first = await scanUsageFromSessions();
    expect(first.added).toBe(2);
    expect(first.scanned).toBe(2);

    const events = await readUsageEvents();
    expect(events.map((e) => e.skillName).sort()).toEqual(["alpha", "beta"]);
    expect(events.find((e) => e.skillName === "alpha")).toMatchObject({
      agent: "claude-code",
      source: "inferred",
      usedAt: "2026-04-20T10:00:00.000Z",
    });
    expect(events.find((e) => e.skillName === "beta")).toMatchObject({
      agent: "codex",
      source: "inferred",
      usedAt: "2026-04-21T09:01:00.000Z",
    });

    const second = await scanUsageFromSessions();
    expect(second.added).toBe(0);
    expect((await readUsageEvents())).toHaveLength(2);

    const state = await readState();
    expect(state.usage?.lastScanAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(state.usage?.skillSetHash).toMatch(/^[a-f0-9]{24}$/);
    expect(Object.keys(state.usage?.processedSessions ?? {})).toHaveLength(2);
  });

  it("dedupes inferred events to one best observation per skill per session", async () => {
    makeSkill("alpha");

    writeEnvelope("codex", "s1", [
      {
        type: "user_message",
        timestamp: "2026-04-21T08:59:00.000Z",
        content: "go",
      },
      {
        type: "agent_message",
        timestamp: "2026-04-21T09:00:00.000Z",
        content: "I'm using the alpha skill now.",
      },
      {
        type: "agent_message",
        timestamp: "2026-04-21T09:01:00.000Z",
        content: [
          {
            type: "tool_use",
            name: "Skill",
            input: { skill: "alpha" },
          },
        ],
      },
    ], "s1");

    const report = await scanUsageFromSessions();
    expect(report.inferred).toBe(1);
    expect(report.added).toBe(1);

    const events = await readUsageEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      skillName: "alpha",
      confidence: 0.95,
      evidence: "native skill invocation",
    });
  });

  it("rescans unchanged sessions when the canonical skill set changes", async () => {
    makeSkill("alpha");
    writeEnvelope("codex", "s1", [
      {
        type: "user_message",
        timestamp: "2026-04-21T08:59:00.000Z",
        content: "go",
      },
      {
        type: "agent_message",
        timestamp: "2026-04-21T09:00:00.000Z",
        content: "I'm using the beta skill now.",
      },
    ], "s1");

    const first = await scanUsageFromSessions();
    expect(first.scanned).toBe(1);
    expect(first.added).toBe(0);

    makeSkill("beta");
    const second = await scanUsageFromSessions();
    expect(second.skillSetChanged).toBe(true);
    expect(second.scanned).toBe(1);
    expect(second.skipped).toBe(0);
    expect(second.added).toBe(1);

    const third = await scanUsageFromSessions();
    expect(third.skillSetChanged).toBe(false);
    expect(third.scanned).toBe(0);
    expect(third.skipped).toBe(1);
  });
});
