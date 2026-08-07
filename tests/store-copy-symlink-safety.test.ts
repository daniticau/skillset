import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  symlinkSync,
  lstatSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TEST_ROOT = join(tmpdir(), `skillset-copy-safety-${process.pid}`);

vi.mock("../src/core/paths.js", () => ({
  STORE_ROOT: join(TEST_ROOT, "store"),
  STORE_SKILLS_DIR: join(TEST_ROOT, "store", "skills"),
}));

const { copyDirReplace } = await import("../src/core/store.js");

beforeEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(TEST_ROOT, { recursive: true });
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe("copyDirReplace symlink safety", () => {
  it("never deletes through a symlinked destination", async () => {
    // Stands in for /Applications/Coast Local.app/.../coast-cli-skill
    const vendor = join(TEST_ROOT, "VendorApp", "skill");
    mkdirSync(vendor, { recursive: true });
    writeFileSync(join(vendor, "SKILL.md"), "vendor content", "utf8");
    writeFileSync(join(vendor, "irreplaceable.bin"), "do not delete", "utf8");

    const src = join(TEST_ROOT, "canonical", "thing");
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, "SKILL.md"), "canonical content", "utf8");

    const dest = join(TEST_ROOT, "mirror", "thing");
    mkdirSync(join(TEST_ROOT, "mirror"), { recursive: true });
    symlinkSync(vendor, dest, "dir");

    await copyDirReplace(src, dest);

    // The vendor directory behind the link must be untouched.
    expect(existsSync(join(vendor, "irreplaceable.bin"))).toBe(true);
    expect(readFileSync(join(vendor, "SKILL.md"), "utf8")).toBe("vendor content");
    // The destination is now a real directory holding the canonical content.
    expect(lstatSync(dest).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(dest, "SKILL.md"), "utf8")).toBe("canonical content");
  });

  it("materializes real files when the source is a symlink", async () => {
    const external = join(TEST_ROOT, "external", "skill");
    mkdirSync(external, { recursive: true });
    writeFileSync(join(external, "SKILL.md"), "external content", "utf8");

    const src = join(TEST_ROOT, "mirror", "linked");
    mkdirSync(join(TEST_ROOT, "mirror"), { recursive: true });
    symlinkSync(external, src, "dir");

    const dest = join(TEST_ROOT, "store", "skills", "linked");
    await copyDirReplace(src, dest);

    // Canonical must own real content, not a pointer into someone else's dir.
    expect(lstatSync(dest).isSymbolicLink()).toBe(false);
    expect(lstatSync(join(dest, "SKILL.md")).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(dest, "SKILL.md"), "utf8")).toBe("external content");
  });
});
