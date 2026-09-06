import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(tmpdir(), `skillset-always-sync-${process.pid}`);
const STORE = join(ROOT, "store");
const SKILLS = join(STORE, "skills");
const CLAUDE_SKILLS = join(ROOT, "claude", "skills");
const CLAUDE_MD = join(ROOT, "claude", "CLAUDE.md");
const CODEX_SKILLS = join(ROOT, "codex", "skills");
const CODEX_MD = join(ROOT, "codex", "AGENTS.md");
const KIMI_SKILLS = join(ROOT, "kimi", "skills");
const KIMI_MD = join(ROOT, "kimi", "AGENTS.md");
const CURSOR_SKILLS = join(ROOT, "cursor", "skills");

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
  DEFAULT_CODEX_SKILLS_DIR: CODEX_SKILLS,
  DEFAULT_KIMI_SKILLS_DIR: KIMI_SKILLS,
  DEFAULT_GROK_SKILLS_DIR: join(ROOT, "grok", "skills"),
  DEFAULT_CURSOR_SKILLS_DIR: CURSOR_SKILLS,
  DEFAULT_AGENTS_SKILLS_DIR: join(ROOT, "agents", "skills"),
  LEGACY_CODEX_SKILLS_DIR: join(ROOT, "legacy"),
}));

const { writeConfig, readState } = await import("../src/core/config.js");
const { sync, status } = await import("../src/core/mirror.js");
const { alwaysCommand, addCommand } = await import("../src/commands/manage.js");
const { inspectSkills } = await import("../src/commands/check.js");
const { ALWAYS_START, ALWAYS_END } = await import("../src/core/adapters/always-block.js");

function makeSkill(name: string, body: string, extra = ""): void {
  const dir = join(SKILLS, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Use when testing ${name}.\n${extra}---\n\n${body}\n`
  );
}

beforeEach(async () => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(SKILLS, { recursive: true });
  mkdirSync(CLAUDE_SKILLS, { recursive: true });
  mkdirSync(CODEX_SKILLS, { recursive: true });
  mkdirSync(CURSOR_SKILLS, { recursive: true });
  process.exitCode = undefined;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  await writeConfig({
    version: 1,
    links: [
      { agent: "claude-code", path: CLAUDE_SKILLS },
      { agent: "codex", path: CODEX_SKILLS },
      { agent: "cursor", path: CURSOR_SKILLS },
    ],
  });
});

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
  rmSync(ROOT, { recursive: true, force: true });
});

describe("always-on skills", () => {
  it("writes always-on bodies into each agent's instructions file, and only those", async () => {
    makeSkill("on-demand", "loaded when it matches");
    makeSkill("never-eyebrows", "# Never use eyebrows\n\nNEVER, EVER USE EYEBROWS.", "always: true\n");

    const report = await sync();

    for (const file of [CLAUDE_MD, CODEX_MD]) {
      const text = readFileSync(file, "utf8");
      expect(text).toContain(ALWAYS_START);
      expect(text).toContain("## Never use eyebrows");
      expect(text).toContain("NEVER, EVER USE EYEBROWS.");
      expect(text).not.toContain("loaded when it matches");
      expect(text).toContain(ALWAYS_END);
    }
    // Cursor has no file-based global instructions.
    expect(existsSync(join(ROOT, "cursor", "AGENTS.md"))).toBe(false);
    expect(existsSync(join(ROOT, "cursor", "CLAUDE.md"))).toBe(false);
    // Both skills still mirror as normal skills.
    expect(existsSync(join(CLAUDE_SKILLS, "never-eyebrows", "SKILL.md"))).toBe(true);
    expect(existsSync(join(CLAUDE_SKILLS, "on-demand", "SKILL.md"))).toBe(true);

    const written = report.actions.filter((a) => a.kind === "always-written");
    expect(written).toHaveLength(2);
  });

  it("keeps the user's own text around the block and is idempotent", async () => {
    mkdirSync(join(ROOT, "claude"), { recursive: true });
    writeFileSync(CLAUDE_MD, "# My rules\n\nKeep this line.\n");
    makeSkill("r", "rule body", "always: true\n");

    await sync();
    const first = readFileSync(CLAUDE_MD, "utf8");
    expect(first.startsWith("# My rules\n\nKeep this line.\n")).toBe(true);
    expect(first).toContain("rule body");

    const second = await sync();
    expect(readFileSync(CLAUDE_MD, "utf8")).toBe(first);
    expect(second.actions.some((a) => a.kind === "always-written")).toBe(false);
  });

  it("does not create an instructions file when there is nothing always-on", async () => {
    makeSkill("plain", "plain body");
    await sync();
    expect(existsSync(CLAUDE_MD)).toBe(false);
    expect(existsSync(CODEX_MD)).toBe(false);
  });

  it("removes the block, but nothing else, when the last always-on skill is turned off", async () => {
    mkdirSync(join(ROOT, "claude"), { recursive: true });
    writeFileSync(CLAUDE_MD, "mine\n");
    makeSkill("r", "rule body", "always: true\n");
    await sync();
    expect(readFileSync(CLAUDE_MD, "utf8")).toContain(ALWAYS_START);

    await alwaysCommand("r", { off: true });
    const text = readFileSync(CLAUDE_MD, "utf8");
    expect(text).toBe("mine\n");
    expect(readFileSync(join(SKILLS, "r", "SKILL.md"), "utf8")).not.toContain("always: true");
  });

  it("`sks always` turns a skill on, re-syncs, and status reports it", async () => {
    makeSkill("r", "rule body");
    await sync();
    expect(existsSync(CLAUDE_MD)).toBe(false);

    await alwaysCommand("r");
    expect(readFileSync(join(SKILLS, "r", "SKILL.md"), "utf8")).toContain("always: true");
    expect(readFileSync(CLAUDE_MD, "utf8")).toContain("rule body");
    const s = await status();
    expect(s.skills.find((sk) => sk.name === "r")?.always).toBe(true);
    expect(s.links.find((l) => l.agent === "claude-code")?.instructionsFile).toBe(CLAUDE_MD);
    expect(s.links.find((l) => l.agent === "cursor")?.instructionsFile).toBeUndefined();
    expect((await readState()).skills.r?.userEdited).toBe(true);
  });

  it("still writes the block for a link whose skills dir aliases the canonical store", async () => {
    // Kimi pointed straight at canonical: skipped for skill writes, but its
    // AGENTS.md is a real file that must carry the rules.
    mkdirSync(join(ROOT, "kimi"), { recursive: true });
    symlinkSync(SKILLS, KIMI_SKILLS);
    await writeConfig({ version: 1, links: [{ agent: "kimi-code", path: KIMI_SKILLS }] });
    makeSkill("r", "rule body", "always: true\n");

    const report = await sync();
    expect(report.actions.filter((a) => a.kind === "mirrored")).toHaveLength(0);
    expect(readFileSync(KIMI_MD, "utf8")).toContain("rule body");
  });

  it("`sks add --always` installs the skill already always-on", async () => {
    await addCommand(undefined, {
      content: "---\nname: fresh\ndescription: Use when testing add.\n---\n\nfresh body\n",
      always: true,
    });
    expect(readFileSync(join(SKILLS, "fresh", "SKILL.md"), "utf8")).toContain("always: true");
    expect(readFileSync(CLAUDE_MD, "utf8")).toContain("fresh body");
  });

  it("check warns when an always-on body is long", async () => {
    makeSkill("long", Array.from({ length: 200 }, (_, i) => `word${i}`).join(" "), "always: true\n");
    const result = await inspectSkills("long");
    expect(result.issues.some((i) => i.message.includes("always-on body is 200 words"))).toBe(true);
  });

  it("refuses to sync when the store is gone but state still tracks skills", async () => {
    makeSkill("r", "rule body");
    await sync();
    rmSync(SKILLS, { recursive: true, force: true });
    await expect(sync()).rejects.toThrow(/refusing to sync/);
    // The mirror copy survived.
    expect(existsSync(join(CLAUDE_SKILLS, "r", "SKILL.md"))).toBe(true);
  });
});
