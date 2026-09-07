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
  DEFAULT_KIMI_SKILLS_DIR: join(ROOT, "kimi-skills"),
  DEFAULT_CURSOR_SKILLS_DIR: join(ROOT, "cursor"),
  DEFAULT_AGENTS_SKILLS_DIR: join(ROOT, "agents"),
}));

const { catalogCommand, categorizeSkill } = await import("../src/commands/catalog.js");
const { writeState } = await import("../src/core/config.js");

beforeEach(async () => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(SKILLS, { recursive: true });
  await writeState({ version: 2, skills: {} });
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
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await catalogCommand();

    const output = outputOf(logSpy);
    expect(output).toContain("Skill Catalog (3 skills)");
    // Grouped by kind of knowledge, not topic.
    expect(output).toContain("Workflow (3)");
    expect(output).toContain("skillify");
  });

  it("classifies skills by the kind of knowledge they carry", () => {
    expect(
      categorizeSkill({
        name: "coast-cli-skill",
        description: "Search past on-screen activity with the coast CLI.",
      })
    ).toBe("Tool");
    expect(
      categorizeSkill({
        name: "ios-app-submission",
        description: "Use when submitting a prepared iOS app to App Store Connect.",
      })
    ).toBe("Workflow");
    expect(
      categorizeSkill({
        name: "ai-research-project-evaluation",
        description: "Use when evaluating, ranking, or choosing research ideas.",
      })
    ).toBe("Judgement");
    expect(
      categorizeSkill({
        name: "confirm-irreversible-release-actions",
        description: "Apply before clicking release buttons that are irreversible.",
      })
    ).toBe("Rule");
  });

  it("does not treat \"whenever\" as the constraint word \"never\"", () => {
    // Substring matching used to classify every "use whenever…" skill as a Rule.
    expect(
      categorizeSkill({
        name: "safe-agent-handoff",
        description: "Prepare a repo for handoff whenever the next agent needs a safe start.",
      })
    ).toBe("Workflow");
  });
});
