import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_ROOT = join(tmpdir(), `skillset-build-${process.pid}`);
const STORE = join(TEST_ROOT, "store");
const SKILLS = join(STORE, "skills");
const MIRROR = join(TEST_ROOT, "mirror");

vi.mock("../src/core/paths.js", () => ({
  STORE_ROOT: STORE,
  STORE_SKILLS_DIR: SKILLS,
  CONFLICTS_DIR: join(STORE, "conflicts"),
  CONFIG_FILE: join(STORE, "config.json"),
  STATE_FILE: join(STORE, "state.json"),
  DEFAULT_CLAUDE_SKILLS_DIR: MIRROR,
  DEFAULT_CODEX_SKILLS_DIR: join(TEST_ROOT, "codex"),
  DEFAULT_KIMI_SKILLS_DIR: join(TEST_ROOT, "kimi"),
  DEFAULT_GROK_SKILLS_DIR: join(TEST_ROOT, "grok"),
  DEFAULT_CURSOR_SKILLS_DIR: join(TEST_ROOT, "cursor"),
  LEGACY_CODEX_SKILLS_DIR: join(TEST_ROOT, "legacy"),
  SESSIONS_DIR: join(STORE, "sessions"),
  USAGE_DIR: join(STORE, "usage"),
  USAGE_EVENTS_FILE: join(STORE, "usage", "events.jsonl"),
  REPORTS_DIR: join(STORE, "reports"),
}));

const { writeConfig } = await import("../src/core/config.js");
const { buildCommand } = await import("../src/commands/build.js");
const { parseDecomposeResponse } = await import("../src/build/decompose.js");

const goodSkill = {
  name: "ship-it-gate",
  description: "Apply before committing when the user says ship it, to run tests and typecheck first.",
  body: "Run the full test suite and typecheck before any commit.\n\nNever push to master directly.",
  kind: "rule" as const,
  trigger: "user says ship it",
  prevents: "broken commits landing on master",
  links: [],
  tier: "medium" as const,
};

beforeEach(async () => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(SKILLS, { recursive: true });
  mkdirSync(MIRROR, { recursive: true });
  await writeConfig({ version: 1, links: [{ agent: "claude-code", path: MIRROR }] });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe("sks build", () => {
  it("installs a valid proposal and mirrors it", async () => {
    await buildCommand([], { proposals: [goodSkill], yes: true });

    const written = join(SKILLS, "ship-it-gate", "SKILL.md");
    expect(existsSync(written)).toBe(true);
    const content = readFileSync(written, "utf8");
    expect(content).toContain("name: ship-it-gate");
    expect(content).toContain("tier: medium");
    // Reaches the connected agent without a separate sync step.
    expect(existsSync(join(MIRROR, "ship-it-gate", "SKILL.md"))).toBe(true);
  });

  it("refuses to install a proposal that would fail sks check", async () => {
    const empty = { ...goodSkill, name: "empty-body-skill", body: "   " };
    await buildCommand([], { proposals: [empty], yes: true });

    expect(existsSync(join(SKILLS, "empty-body-skill"))).toBe(false);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it("installs the valid half of a mixed batch", async () => {
    const bad = { ...goodSkill, name: "bad-one", description: "" };
    await buildCommand([], { proposals: [goodSkill, bad], yes: true });

    expect(existsSync(join(SKILLS, "ship-it-gate", "SKILL.md"))).toBe(true);
    expect(existsSync(join(SKILLS, "bad-one"))).toBe(false);
  });

  it("does not write anything on --dry-run", async () => {
    await buildCommand([], { proposals: [goodSkill], dryRun: true, yes: true });
    expect(existsSync(join(SKILLS, "ship-it-gate"))).toBe(false);
  });
});

describe("parseDecomposeResponse", () => {
  it("keeps only well-formed skills and caps the batch at 4", () => {
    const result = parseDecomposeResponse(
      JSON.stringify({
        rationale: "split into a rule and its reference",
        skills: [
          goodSkill,
          { name: "Bad Name With Spaces", description: "x", body: "y" },
          { name: "no-body", description: "Use when testing." },
          ...Array.from({ length: 5 }, (_, i) => ({
            ...goodSkill,
            name: `extra-skill-${i}`,
          })),
        ],
      })
    );
    expect(result.skills.length).toBe(4);
    expect(result.skills.map((s: { name: string }) => s.name)).not.toContain("Bad Name With Spaces");
    expect(result.skills.map((s: { name: string }) => s.name)).not.toContain("no-body");
    expect(result.rationale).toBe("split into a rule and its reference");
  });

  it("returns an empty proposal when the model declines to add a skill", () => {
    const result = parseDecomposeResponse(
      JSON.stringify({ rationale: "already covered by skillify", skills: [] })
    );
    expect(result.skills).toEqual([]);
    expect(result.rationale).toBe("already covered by skillify");
  });

  it("survives a non-JSON response", () => {
    const result = parseDecomposeResponse("I'm afraid I can't do that");
    expect(result.skills).toEqual([]);
  });
});
