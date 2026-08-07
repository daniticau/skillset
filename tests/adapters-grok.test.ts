import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(tmpdir(), `skillset-grok-adapter-${process.pid}`);
const STORE = join(ROOT, "store", "skills");
const MIRROR = join(ROOT, ".grok", "skills");

vi.mock("../src/core/paths.js", () => ({
  STORE_ROOT: join(ROOT, "store"),
  STORE_SKILLS_DIR: STORE,
}));

const { grokAdapter } = await import("../src/core/adapters/grok.js");

afterEach(() => rmSync(ROOT, { recursive: true, force: true }));

describe("Grok CLI skills adapter", () => {
  it("uses Grok's per-skill user directory layout", async () => {
    const source = join(STORE, "alpha");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "SKILL.md"), "---\nname: alpha\ndescription: a\n---\n\nalpha body\n");

    await grokAdapter.mirrorSkill!(
      { frontmatter: { name: "alpha", description: "a" }, body: "alpha body" },
      MIRROR
    );

    expect(grokAdapter.layout).toBe("per-skill-dir");
    expect(grokAdapter.defaultPath).toContain(join(".grok", "skills"));
    expect(readFileSync(join(MIRROR, "alpha", "SKILL.md"), "utf8")).toContain("alpha body");
  });
});
