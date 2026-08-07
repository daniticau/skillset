import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const ROOT = join(tmpdir(), `skillset-kimi-adapter-${process.pid}`);
const STORE = join(ROOT, "store");
const SKILLS = join(STORE, "skills");
const MIRROR = join(ROOT, ".kimi-code", "skills");

vi.mock("../src/core/paths.js", () => ({
  STORE_ROOT: STORE,
  STORE_SKILLS_DIR: SKILLS,
  SESSIONS_DIR: join(STORE, "sessions"),
  USAGE_DIR: join(STORE, "usage"),
  USAGE_EVENTS_FILE: join(STORE, "usage", "events.jsonl"),
  CONFLICTS_DIR: join(STORE, "conflicts"),
  CONFIG_FILE: join(STORE, "config.json"),
  STATE_FILE: join(STORE, "state.json"),
  DEFAULT_CLAUDE_SKILLS_DIR: join(ROOT, ".claude", "skills"),
  DEFAULT_CODEX_SKILLS_DIR: join(ROOT, ".codex", "skills"),
  DEFAULT_KIMI_SKILLS_DIR: MIRROR,
  DEFAULT_CURSOR_SKILLS_DIR: MIRROR,
  LEGACY_CODEX_SKILLS_DIR: join(ROOT, ".agents", "skills"),
}));

const { kimiCodeAdapter } = await import("../src/core/adapters/kimi-code.js");

afterEach(() => rmSync(ROOT, { recursive: true, force: true }));

describe("Kimi Code skills adapter", () => {
  it("uses Kimi's per-skill user directory layout", async () => {
    const source = join(SKILLS, "alpha");
    mkdirSync(source, { recursive: true });
    writeFileSync(
      join(source, "SKILL.md"),
      "---\nname: alpha\ndescription: a\n---\n\nalpha body\n"
    );

    await kimiCodeAdapter.mirrorSkill!(
      { frontmatter: { name: "alpha", description: "a" }, body: "alpha body" },
      MIRROR
    );

    expect(kimiCodeAdapter.layout).toBe("per-skill-dir");
    expect(kimiCodeAdapter.defaultPath).toContain(join(".kimi-code", "skills"));
    expect(readFileSync(join(MIRROR, "alpha", "SKILL.md"), "utf8")).toContain("alpha body");
  });
});
