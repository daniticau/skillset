import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cursorAdapter } from "../src/core/adapters/cursor.js";

const ROOT = join(tmpdir(), `skillset-cursor-test-${process.pid}`);

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe("cursor adapter metadata round-trip", () => {
  it("emits skillset-name + tier + origin into .mdc frontmatter", async () => {
    await cursorAdapter.mirrorSkill!(
      {
        frontmatter: {
          name: "commit-style",
          description: "Use conventional commits",
          tier: "medium",
          origin: "auto-created",
        },
        body: "body here",
      },
      ROOT
    );
    const raw = readFileSync(join(ROOT, "commit-style.mdc"), "utf8");
    expect(raw).toContain("skillset-name: commit-style");
    expect(raw).toContain("skillset-tier: medium");
    expect(raw).toContain("skillset-origin: auto-created");
  });

  it("omits tier/origin fields when not set", async () => {
    await cursorAdapter.mirrorSkill!(
      {
        frontmatter: { name: "naked", description: "no metadata" },
        body: "body",
      },
      ROOT
    );
    const raw = readFileSync(join(ROOT, "naked.mdc"), "utf8");
    expect(raw).not.toContain("skillset-tier");
    expect(raw).not.toContain("skillset-origin");
  });

  it("readMirrorSkill recovers tier + origin from a file we wrote", async () => {
    await cursorAdapter.mirrorSkill!(
      {
        frontmatter: {
          name: "roundtrip",
          description: "",
          tier: "high",
          origin: "user-created",
        },
        body: "body",
      },
      ROOT
    );
    const read = await cursorAdapter.readMirrorSkill!("roundtrip", ROOT);
    expect(read?.frontmatter.tier).toBe("high");
    expect(read?.frontmatter.origin).toBe("user-created");
  });

  it("readMirrorSkill ignores garbage values for tier/origin", async () => {
    await cursorAdapter.mirrorSkill!(
      {
        frontmatter: { name: "user-edited", description: "" },
        body: "body",
      },
      ROOT
    );
    // Simulate a user hand-editing the .mdc with nonsense tier
    const fs = await import("node:fs/promises");
    await fs.writeFile(
      join(ROOT, "user-edited.mdc"),
      `---\ndescription: ""\nglobs: []\nalwaysApply: false\nskillset-name: user-edited\nskillset-tier: bogus\nskillset-origin: aliens\n---\n\nbody\n`,
      "utf8"
    );
    const read = await cursorAdapter.readMirrorSkill!("user-edited", ROOT);
    expect(read?.frontmatter.tier).toBeUndefined();
    expect(read?.frontmatter.origin).toBeUndefined();
  });
});
