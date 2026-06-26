import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(tmpdir(), `skillset-catalog-command-${process.pid}`);
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

const { catalogCommand, categorizeSkill } = await import("../src/commands/catalog.js");
const { appendUsageEvents, createExplicitUsageEvent } = await import("../src/usage/events.js");
const { writeState } = await import("../src/core/config.js");

beforeEach(async () => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(SKILLS, { recursive: true });
  await writeState({ version: 2, skills: {}, reviewedDates: {} });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(ROOT, { recursive: true, force: true });
});

function makeSkill(name: string, description: string, extra = ""): void {
  const dir = join(SKILLS, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${JSON.stringify(description)}${extra}\n---\n\n${name} body\n`
  );
}

function outputOf(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((args) => args.join(" ")).join("\n");
}

describe("catalog command", () => {
  it("groups canonical skills by likely use case and includes usage counts", async () => {
    makeSkill("ios-prep-skill", "Do iOS app prep for a local iOS app repo.");
    makeSkill(
      "resume-tailoring-builder",
      "Build, revise, and tailor resumes for specific jobs."
    );
    makeSkill(
      "skillify",
      "Use Skillset when the user asks to capture a reusable agent preference.",
      "\ntier: medium\norigin: user-created"
    );
    await appendUsageEvents([
      createExplicitUsageEvent({
        skillName: "skillify",
        agent: "codex",
        usedAt: "2026-05-08T12:00:00.000Z",
      }),
    ]);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await catalogCommand();

    const output = outputOf(logSpy);
    expect(output).toContain("Skill Catalog (3 skills)");
    expect(output).toContain("Skill Capture & Memory (1)");
    expect(output).toContain("iOS & App Store (1)");
    expect(output).toContain("Writing & Applications (1)");
    expect(output).toContain("skillify");
    expect(output).toContain("1 use, last 2026-05-08");
  });

  it("classifies common skill descriptions predictably", () => {
    expect(
      categorizeSkill({
        name: "terminal-screen-recordings",
        description: "Apply when creating terminal screen recordings or demos.",
      })
    ).toBe("Visual, Media & Assets");
    expect(
      categorizeSkill({
        name: "confirm-irreversible-release-actions",
        description: "Apply when operating release or deployment UIs.",
      })
    ).toBe("Release Safety");
  });
});
