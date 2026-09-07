import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  utimesSync,
  readdirSync,
  existsSync,
  symlinkSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_ROOT = join(tmpdir(), "skillset-test-fixed");
const STORE = join(TEST_ROOT, "store");
const SKILLS = join(STORE, "skills");
const MIRROR = join(TEST_ROOT, "mirror");
const CODEX_MIRROR = join(TEST_ROOT, "codex-mirror");
const LEGACY_CODEX_MIRROR = join(TEST_ROOT, "legacy-codex-mirror");
const KIMI_ALIAS = join(TEST_ROOT, "kimi-alias");
const CONFLICTS = join(STORE, "conflicts");

vi.mock("../src/core/paths.js", () => ({
  STORE_ROOT: STORE,
  STORE_SKILLS_DIR: SKILLS,
  CONFLICTS_DIR: CONFLICTS,
  CONFIG_FILE: join(STORE, "config.json"),
  STATE_FILE: join(STORE, "state.json"),
  DEFAULT_CLAUDE_SKILLS_DIR: MIRROR,
  DEFAULT_CODEX_SKILLS_DIR: CODEX_MIRROR,
  DEFAULT_KIMI_SKILLS_DIR: join(TEST_ROOT, "kimi-mirror"),
  DEFAULT_CURSOR_SKILLS_DIR: join(TEST_ROOT, "cursor"),
  DEFAULT_AGENTS_SKILLS_DIR: join(TEST_ROOT, "agents"),
  LEGACY_CODEX_SKILLS_DIR: LEGACY_CODEX_MIRROR,
}));

// eager imports so the mocked paths module is loaded once
const { readState, writeConfig, writeState } = await import("../src/core/config.js");
const { sync } = await import("../src/core/mirror.js");
const { connectCommand } = await import("../src/commands/link.js");
const { removeCommand } = await import("../src/commands/manage.js");

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
  mkdirSync(CODEX_MIRROR, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
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

  it("copies canonical skills to the Codex user skills mirror", async () => {
    await writeConfig({ version: 1, links: [{ agent: "codex", path: CODEX_MIRROR }] });
    makeSkill(SKILLS, "alpha", "alpha body");

    const report = await sync();
    expect(report.skillCount).toBe(1);
    expect(readFileSync(join(CODEX_MIRROR, "alpha", "SKILL.md"), "utf8")).toContain("alpha body");
  });

  it("mirrors every canonical skill to every connected agent", async () => {
    await writeConfig({
      version: 1,
      links: [
        { agent: "claude-code", path: MIRROR },
        { agent: "codex", path: CODEX_MIRROR },
      ],
    });
    makeSkill(SKILLS, "selective", "shared by default");
    await sync();

    await sync({ adoptUntracked: false });

    expect(existsSync(join(MIRROR, "selective", "SKILL.md"))).toBe(true);
    expect(readFileSync(join(CODEX_MIRROR, "selective", "SKILL.md"), "utf8")).toContain(
      "shared by default"
    );
  });

  it("treats a Kimi skills symlink to canonical as a zero-copy link", async () => {
    symlinkSync(SKILLS, KIMI_ALIAS, "dir");
    await writeConfig({ version: 1, links: [{ agent: "kimi-code", path: KIMI_ALIAS }] });
    makeSkill(SKILLS, "shared", "canonical body");

    const first = await sync({ importExisting: true });
    expect(first.linkCount).toBe(1);
    expect(first.actions).toHaveLength(0);
    expect(readFileSync(join(KIMI_ALIAS, "shared", "SKILL.md"), "utf8")).toContain(
      "canonical body"
    );

    writeFileSync(
      join(SKILLS, "shared", "SKILL.md"),
      `---\nname: shared\ndescription: Test skill for shared.\n---\n\nupdated canonically\n`
    );
    const second = await sync();
    expect(second.actions).toHaveLength(0);
    expect(readFileSync(join(KIMI_ALIAS, "shared", "SKILL.md"), "utf8")).toContain(
      "updated canonically"
    );
  });

  it("migrates the legacy Codex mirror path to the desktop skills path before writing", async () => {
    mkdirSync(LEGACY_CODEX_MIRROR, { recursive: true });
    await writeConfig({ version: 1, links: [{ agent: "codex", path: LEGACY_CODEX_MIRROR }] });
    makeSkill(SKILLS, "codex-desktop", "visible in Codex Desktop skills");

    const report = await sync();

    expect(report.linkCount).toBe(1);
    expect(readFileSync(join(CODEX_MIRROR, "codex-desktop", "SKILL.md"), "utf8")).toContain(
      "visible in Codex Desktop skills"
    );
  });

  it("imports Codex Skills page-only skills before mirroring canonical skills back out", async () => {
    await writeConfig({ version: 1, links: [{ agent: "codex", path: CODEX_MIRROR }] });
    makeSkill(SKILLS, "canonical", "canonical body");
    makeSkill(CODEX_MIRROR, "page-only", "already in Codex UI");

    const report = await sync({ importExisting: true });

    expect(report.actions).toContainEqual({
      kind: "adopted",
      skill: "page-only",
      from: { agent: "codex", path: CODEX_MIRROR },
    });
    expect(readFileSync(join(SKILLS, "page-only", "SKILL.md"), "utf8")).toContain(
      "already in Codex UI"
    );
    expect(readFileSync(join(CODEX_MIRROR, "canonical", "SKILL.md"), "utf8")).toContain(
      "canonical body"
    );
  });

  it("skips rewriting mirrors that already match canonical", async () => {
    await writeConfig({ version: 1, links: [{ agent: "claude-code", path: MIRROR }] });
    makeSkill(SKILLS, "steady", "unchanged body");

    const first = await sync();
    expect(first.actions.filter((a) => a.kind === "mirrored")).toHaveLength(1);

    // Age the mirror file so a rewrite would be detectable via mtime.
    const mirrorPath = join(MIRROR, "steady", "SKILL.md");
    setMtime(mirrorPath, 3600);
    const mtimeBefore = statSync(mirrorPath).mtimeMs;

    const second = await sync();
    expect(second.actions.filter((a) => a.kind === "mirrored")).toHaveLength(0);
    expect(statSync(mirrorPath).mtimeMs).toBe(mtimeBefore);
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
        { agent: "codex", path: CODEX_MIRROR },
      ],
    });
    makeSkill(SKILLS, "delta", "original body");
    await sync();

    // Edit both mirrors. claude-code edit is older, codex edit is newer.
    const claudePath = join(MIRROR, "delta", "SKILL.md");
    writeFileSync(
      claudePath,
      `---\nname: delta\ndescription: Test skill for delta.\n---\n\nclaude edit\n`
    );
    setMtime(claudePath, 60); // 60s ago — older

    const codexPath = join(CODEX_MIRROR, "delta", "SKILL.md");
    writeFileSync(
      codexPath,
      `---\nname: delta\ndescription: Test skill for delta.\n---\n\ncodex edit\n`
    );
    setMtime(codexPath, 5); // 5s ago — newer; should win

    const report = await sync();
    const conflicts = report.actions.filter((a) => a.kind === "conflict");
    expect(conflicts).toHaveLength(1);
    const conflict = conflicts[0]!;
    if (conflict.kind !== "conflict") throw new Error("expected conflict");
    expect(conflict.winner.agent).toBe("codex");
    expect(conflict.losers.map((l) => l.agent)).toEqual(["claude-code"]);

    // Canonical should hold the codex (winner) body.
    const canon = readFileSync(join(SKILLS, "delta", "SKILL.md"), "utf8");
    expect(canon).toContain("codex edit");
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
    expect(ctx).toContain("Winner adapter: codex");
    expect(ctx).toContain("Loser adapter: claude-code");
  });

  it("initial import conflict: newest mirror wins before first write", async () => {
    await writeConfig({
      version: 1,
      links: [
        { agent: "claude-code", path: MIRROR },
        { agent: "codex", path: CODEX_MIRROR },
      ],
    });

    makeSkill(MIRROR, "epsilon", "older mirror body");
    setMtime(join(MIRROR, "epsilon", "SKILL.md"), 60);
    mkdirSync(join(CODEX_MIRROR, "epsilon"), { recursive: true });
    writeFileSync(
      join(CODEX_MIRROR, "epsilon", "SKILL.md"),
      `---\nname: epsilon\ndescription: Test skill for epsilon.\n---\n\nnewer codex body\n`
    );
    setMtime(join(CODEX_MIRROR, "epsilon", "SKILL.md"), 5);

    const report = await sync({ importExisting: true });
    const conflicts = report.actions.filter((a) => a.kind === "conflict");
    expect(conflicts).toHaveLength(1);
    expect(readFileSync(join(SKILLS, "epsilon", "SKILL.md"), "utf8")).toContain("newer codex body");
    expect(readFileSync(join(MIRROR, "epsilon", "SKILL.md"), "utf8")).toContain("newer codex body");
    expect(existsSync(CONFLICTS)).toBe(true);
  });

  it("does not double-promote after an import conflict against canonical", async () => {
    await writeConfig({ version: 1, links: [{ agent: "codex", path: CODEX_MIRROR }] });
    makeSkill(SKILLS, "theta", "original body");
    await sync();

    const canonicalPath = join(SKILLS, "theta", "SKILL.md");
    writeFileSync(
      canonicalPath,
      `---\nname: theta\ndescription: Test skill for theta.\n---\n\nolder canonical body\n`
    );
    setMtime(canonicalPath, 60);

    const mirrorPath = join(CODEX_MIRROR, "theta", "SKILL.md");
    writeFileSync(
      mirrorPath,
      `---\nname: theta\ndescription: Test skill for theta.\n---\n\nnewer codex body\n`
    );
    setMtime(mirrorPath, 5);

    const report = await sync({ importExisting: true });

    const conflicts = report.actions.filter((a) => a.kind === "conflict");
    expect(conflicts).toHaveLength(1);
    const conflict = conflicts[0]!;
    if (conflict.kind !== "conflict") throw new Error("expected conflict");
    expect(conflict.winner.agent).toBe("codex");
    expect(conflict.archivedLoserCount).toBe(1);
    expect(conflict.loserLabels).toEqual(["canonical"]);
    expect(
      report.actions.filter((a) => a.kind === "promoted" && a.skill === "theta")
    ).toHaveLength(0);
    expect(readFileSync(join(SKILLS, "theta", "SKILL.md"), "utf8")).toContain(
      "newer codex body"
    );
  });

  it("connect imports an existing mirror before mirroring back out", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await writeConfig({ version: 1, links: [] });
    makeSkill(MIRROR, "zeta", "preexisting mirror body");

    await connectCommand("claude-code", { path: MIRROR });

    expect(readFileSync(join(SKILLS, "zeta", "SKILL.md"), "utf8")).toContain(
      "preexisting mirror body"
    );
    expect(readFileSync(join(MIRROR, "zeta", "SKILL.md"), "utf8")).toContain(
      "preexisting mirror body"
    );
  });

  it("remove deletes canonical and prunes linked mirrors", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await writeConfig({ version: 1, links: [{ agent: "claude-code", path: MIRROR }] });
    makeSkill(SKILLS, "eta", "remove me");
    await sync();
    expect(existsSync(join(MIRROR, "eta", "SKILL.md"))).toBe(true);

    await removeCommand("eta");

    expect(existsSync(join(SKILLS, "eta"))).toBe(false);
    expect(existsSync(join(MIRROR, "eta"))).toBe(false);
  });
});
