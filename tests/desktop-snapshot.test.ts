import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(tmpdir(), `skillset-desktop-snapshot-${process.pid}`);
const SKILLS = join(ROOT, "skills");
const CODEX = join(ROOT, "codex");

vi.mock("../src/core/paths.js", () => ({
  STORE_ROOT: ROOT,
  STORE_SKILLS_DIR: SKILLS,
  SESSIONS_DIR: join(ROOT, "sessions"),
  USAGE_DIR: join(ROOT, "usage"),
  USAGE_EVENTS_FILE: join(ROOT, "usage", "events.jsonl"),
  CONFLICTS_DIR: join(ROOT, "conflicts"),
  REPORTS_DIR: join(ROOT, "reports"),
  CONFIG_FILE: join(ROOT, "config.json"),
  STATE_FILE: join(ROOT, "state.json"),
  DEFAULT_CLAUDE_SKILLS_DIR: join(ROOT, "claude"),
  DEFAULT_CODEX_SKILLS_DIR: CODEX,
  DEFAULT_KIMI_SKILLS_DIR: join(ROOT, "kimi"),
  DEFAULT_GROK_SKILLS_DIR: join(ROOT, "grok"),
  DEFAULT_CURSOR_SKILLS_DIR: join(ROOT, "cursor"),
  LEGACY_CODEX_SKILLS_DIR: join(ROOT, "legacy"),
}));

vi.mock("../src/core/scheduler/macos.js", () => ({
  dreamScheduleStatus: vi.fn(async () => ({ installed: false, atTime: null, reason: null })),
}));

const { createDesktopSnapshot } = await import("../src/desktop/snapshot.js");

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(join(SKILLS, "focused-testing"), { recursive: true });
  mkdirSync(join(CODEX, "focused-testing"), { recursive: true });
  const markdown = `---\nname: focused-testing\ndescription: Use focused tests.\ntier: medium\norigin: user-created\n---\n\n# Focused testing\n\nRun the narrow test first.\n`;
  writeFileSync(join(SKILLS, "focused-testing", "SKILL.md"), markdown);
  writeFileSync(join(CODEX, "focused-testing", "SKILL.md"), markdown);
  writeFileSync(
    join(ROOT, "config.json"),
    JSON.stringify({ version: 1, links: [{ agent: "codex", path: CODEX }] })
  );
  writeFileSync(join(ROOT, "state.json"), JSON.stringify({ version: 2, skills: {} }));
});

describe("desktop snapshot", () => {
  it("returns complete canonical markdown and connectable rows for missing agents", async () => {
    const snapshot = await createDesktopSnapshot() as {
      skills: Array<{
        name: string;
        markdown: string;
        category: string;
      }>;
      connections: Array<{ agent: string; configured: boolean; status: string }>;
      history: Array<{ kind: string }>;
    };

    expect(snapshot.skills[0]).toMatchObject({ name: "focused-testing" });
    expect(snapshot.skills[0]?.markdown).toContain("# Focused testing");
    expect(snapshot.skills[0]?.markdown).not.toContain("tier:");
    expect(snapshot.skills[0]).toMatchObject({ category: "Workflow" });
    expect(snapshot.history).toEqual([]);
    expect(snapshot.connections).toEqual(expect.arrayContaining([
      expect.objectContaining({ agent: "codex", configured: true, status: "live" }),
      expect.objectContaining({ agent: "claude-code", configured: false, status: "offline" }),
      expect.objectContaining({ agent: "kimi-code", configured: false, status: "offline" }),
      expect.objectContaining({ agent: "grok", configured: false, status: "offline" }),
    ]));
  });
});
