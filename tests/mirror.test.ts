import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  utimesSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_ROOT = join(tmpdir(), "skillset-test-fixed");
const STORE = join(TEST_ROOT, "store");
const SKILLS = join(STORE, "skills");
const MIRROR = join(TEST_ROOT, "mirror");
const CURSOR_MIRROR = join(TEST_ROOT, "cursor-mirror");
const CONFLICTS = join(STORE, "conflicts");

vi.mock("../src/core/paths.js", () => ({
  STORE_ROOT: STORE,
  STORE_SKILLS_DIR: SKILLS,
  CONFLICTS_DIR: CONFLICTS,
  CONFIG_FILE: join(STORE, "config.json"),
  STATE_FILE: join(STORE, "state.json"),
  DEFAULT_CLAUDE_SKILLS_DIR: MIRROR,
}));

// eager imports so the mocked paths module is loaded once
const { writeConfig } = await import("../src/core/config.js");
const { sync } = await import("../src/core/mirror.js");

function makeSkill(root: string, name: string, body: string) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Test skill for ${name}.\n---\n\n${body}\n`
  );
}

beforeEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(SKILLS, { recursive: true });
  mkdirSync(MIRROR, { recursive: true });
  mkdirSync(CURSOR_MIRROR, { recursive: true });
});

function setMtime(path: string, secondsAgo: number): void {
  const t = (Date.now() - secondsAgo * 1000) / 1000;
  utimesSync(path, t, t);
}

describe("mirror sync", () => {
  it("copies canonical skills to mirror on first sync", async () => {
    await writeConfig({ version: 1, links: [{ agent: "claude-code", path: MIRROR }] });
    makeSkill(SKILLS, "alpha", "alpha body");

    const report = await sync();
    expect(report.skillCount).toBe(1);
    expect(readFileSync(join(MIRROR, "alpha", "SKILL.md"), "utf8")).toContain("alpha body");
  });

  it("promotes user edits in the mirror back to canonical", async () => {
    await writeConfig({ version: 1, links: [{ agent: "claude-code", path: MIRROR }] });
    makeSkill(SKILLS, "beta", "original body");
    await sync();

    writeFileSync(
      join(MIRROR, "beta", "SKILL.md"),
      `---\nname: beta\ndescription: Test skill for beta.\n---\n\nedited body\n`
    );

    const report = await sync();
    const promoted = report.actions.filter((a) => a.kind === "promoted");
    expect(promoted).toHaveLength(1);
    expect(readFileSync(join(SKILLS, "beta", "SKILL.md"), "utf8")).toContain("edited body");
  });

  it("adopts a skill that exists only in the mirror", async () => {
    await writeConfig({ version: 1, links: [{ agent: "claude-code", path: MIRROR }] });
    makeSkill(MIRROR, "gamma", "mirror-born body");

    const report = await sync();
    const adopted = report.actions.filter((a) => a.kind === "adopted");
    expect(adopted).toHaveLength(1);
    expect(readFileSync(join(SKILLS, "gamma", "SKILL.md"), "utf8")).toContain("mirror-born body");
  });

  it("multi-mirror divergence: newest mtime wins, loser archived to conflicts dir", async () => {
    await writeConfig({
      version: 1,
      links: [
        { agent: "claude-code", path: MIRROR },
        { agent: "cursor", path: CURSOR_MIRROR },
      ],
    });
    makeSkill(SKILLS, "delta", "original body");
    await sync();

    // Edit both mirrors. claude-code edit is older, cursor edit is newer.
    const claudePath = join(MIRROR, "delta", "SKILL.md");
    writeFileSync(
      claudePath,
      `---\nname: delta\ndescription: Test skill for delta.\n---\n\nclaude edit\n`
    );
    setMtime(claudePath, 60); // 60s ago — older

    const cursorPath = join(CURSOR_MIRROR, "delta.mdc");
    writeFileSync(
      cursorPath,
      `---\ndescription: "Test skill for delta."\nglobs: []\nalwaysApply: false\nskillset-name: delta\n---\n\ncursor edit\n`
    );
    setMtime(cursorPath, 5); // 5s ago — newer; should win

    const report = await sync();
    const conflicts = report.actions.filter((a) => a.kind === "conflict");
    expect(conflicts).toHaveLength(1);
    const conflict = conflicts[0]!;
    if (conflict.kind !== "conflict") throw new Error("expected conflict");
    expect(conflict.winner.agent).toBe("cursor");
    expect(conflict.losers.map((l) => l.agent)).toEqual(["claude-code"]);

    // Canonical should hold the cursor (winner) body.
    const canon = readFileSync(join(SKILLS, "delta", "SKILL.md"), "utf8");
    expect(canon).toContain("cursor edit");
    expect(canon).not.toContain("claude edit");

    // Loser should be archived under conflicts/<ts>/delta/claude-code/.
    expect(existsSync(CONFLICTS)).toBe(true);
    const tsDirs = readdirSync(CONFLICTS);
    expect(tsDirs.length).toBeGreaterThan(0);
    const archivedSkill = join(CONFLICTS, tsDirs[0]!, "delta", "claude-code", "SKILL.md");
    expect(existsSync(archivedSkill)).toBe(true);
    expect(readFileSync(archivedSkill, "utf8")).toContain("claude edit");
    const ctx = readFileSync(
      join(CONFLICTS, tsDirs[0]!, "delta", "claude-code", "CONTEXT.md"),
      "utf8"
    );
    expect(ctx).toContain("Winner adapter: cursor");
    expect(ctx).toContain("Loser adapter: claude-code");
  });
});
