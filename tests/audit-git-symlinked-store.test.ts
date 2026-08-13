import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileP = promisify(execFile);

const TEST_ROOT = join(tmpdir(), `skillset-audit-symlink-${process.pid}`);
const STORE = join(TEST_ROOT, "store");
// The real skills live outside the store, linked in — the user's actual layout.
const EXTERNAL_SKILLS = join(TEST_ROOT, "external-skills");

vi.mock("../src/core/paths.js", () => ({
  STORE_ROOT: STORE,
  STORE_SKILLS_DIR: join(STORE, "skills"),
  CONFLICTS_DIR: join(STORE, "conflicts"),
  CONFIG_FILE: join(STORE, "config.json"),
  STATE_FILE: join(STORE, "state.json"),
  DEFAULT_CLAUDE_SKILLS_DIR: join(TEST_ROOT, "mirror"),
  DEFAULT_CURSOR_SKILLS_DIR: join(TEST_ROOT, "cursor"),
  DEFAULT_AGENTS_SKILLS_DIR: join(TEST_ROOT, "agents"),
  SESSIONS_DIR: join(STORE, "sessions"),
}));

const { commitStoreChange, resolveAuditRepo } = await import("../src/core/audit/git.js");


beforeEach(async () => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(STORE, { recursive: true });
  mkdirSync(EXTERNAL_SKILLS, { recursive: true });
  symlinkSync(EXTERNAL_SKILLS, join(STORE, "skills"), "dir");
  await execFileP("git", ["-C", STORE, "init", "--initial-branch=main"]);
  await execFileP("git", ["-C", STORE, "config", "--local", "commit.gpgsign", "false"]);
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

function writeSkill(name: string, body: string) {
  mkdirSync(join(EXTERNAL_SKILLS, name), { recursive: true });
  writeFileSync(
    join(EXTERNAL_SKILLS, name, "SKILL.md"),
    `---\nname: ${name}\ndescription: Use when ${name} applies.\n---\n\n${body}\n`,
    "utf8"
  );
}

describe("audit git with a symlinked skills directory", () => {
  it("resolves the audit repo to the real skills directory", () => {
    const repo = resolveAuditRepo();
    expect(repo.isStoreRoot).toBe(false);
    // realpath, so compare resolved forms (macOS /var -> /private/var).
    expect(repo.root).toContain("external-skills");
  });

  it("commits actual skill content, not just the symlink", async () => {
    writeSkill("real-skill", "the body that must be recoverable");

    const result = await commitStoreChange("build: new-skill");
    expect(result).not.toBeNull();

    // The committed tree must contain the skill file itself. Committing the
    // store root would record a single mode-120000 symlink entry instead.
    const { stdout } = await execFileP("git", [
      "-C",
      EXTERNAL_SKILLS,
      "ls-tree",
      "-r",
      "HEAD",
      "--name-only",
    ]);
    const tracked = stdout.trim().split("\n");
    expect(tracked).toContain("real-skill/SKILL.md");

    const { stdout: blob } = await execFileP("git", [
      "-C",
      EXTERNAL_SKILLS,
      "show",
      "HEAD:real-skill/SKILL.md",
    ]);
    expect(blob).toContain("the body that must be recoverable");
  });

  it("initializes a repo when the linked skills dir has none", async () => {
    rmSync(join(EXTERNAL_SKILLS, ".git"), { recursive: true, force: true });
    writeSkill("first-skill", "content");

    const result = await commitStoreChange("build: new-skill");

    expect(result).not.toBeNull();
    const { stdout } = await execFileP("git", [
      "-C",
      EXTERNAL_SKILLS,
      "ls-tree",
      "-r",
      "HEAD",
      "--name-only",
    ]);
    expect(stdout).toContain("first-skill/SKILL.md");
  });
});
