import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexAdapter } from "../src/core/adapters/codex.js";

const ROOT = join(tmpdir(), `skillset-codex-test-${process.pid}`);
const AGENTS = join(ROOT, "AGENTS.md");

beforeEach(() => {
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(ROOT, { recursive: true });
});

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe("codex aggregate adapter", () => {
  it("creates AGENTS.md with the managed block when target is new", async () => {
    await codexAdapter.mirrorAll!(
      [{ frontmatter: { name: "alpha", description: "a" }, body: "alpha body" }],
      AGENTS
    );
    const raw = readFileSync(AGENTS, "utf8");
    expect(raw).toContain("<!-- skillset:begin");
    expect(raw).toContain("<!-- skillset:end -->");
    expect(raw).toContain("## alpha");
    expect(raw).toContain("alpha body");
  });

  it("preserves user content above + below the managed block", async () => {
    const initial = [
      "# My Codex rules",
      "",
      "## user notes",
      "keep me around",
      "",
      "<!-- skillset:begin — do not edit this block -->",
      "",
      "# Skills (managed by skillset)",
      "",
      "## old",
      "",
      "old body",
      "",
      "<!-- skillset:end -->",
      "",
      "## footer",
      "still here",
      "",
    ].join("\n");
    writeFileSync(AGENTS, initial);

    await codexAdapter.mirrorAll!(
      [{ frontmatter: { name: "fresh", description: "" }, body: "fresh body" }],
      AGENTS
    );
    const raw = readFileSync(AGENTS, "utf8");
    expect(raw).toContain("## user notes");
    expect(raw).toContain("keep me around");
    expect(raw).toContain("## footer");
    expect(raw).toContain("still here");
    expect(raw).toContain("## fresh");
    expect(raw).not.toContain("## old");
  });

  it("hashAggregate changes when canonical skills change", async () => {
    await codexAdapter.mirrorAll!(
      [{ frontmatter: { name: "a", description: "" }, body: "first" }],
      AGENTS
    );
    const h1 = await codexAdapter.hashAggregate!(AGENTS);

    await codexAdapter.mirrorAll!(
      [{ frontmatter: { name: "a", description: "" }, body: "second" }],
      AGENTS
    );
    const h2 = await codexAdapter.hashAggregate!(AGENTS);
    expect(h1).not.toBe(h2);
  });

  it("hashAggregate ignores user content outside the block", async () => {
    await codexAdapter.mirrorAll!(
      [{ frontmatter: { name: "a", description: "" }, body: "body" }],
      AGENTS
    );
    const h1 = await codexAdapter.hashAggregate!(AGENTS);

    // Append user text OUTSIDE the block
    writeFileSync(
      AGENTS,
      readFileSync(AGENTS, "utf8") + "\n\n## user scratch\nmore user text\n"
    );
    const h2 = await codexAdapter.hashAggregate!(AGENTS);
    expect(h1).toBe(h2);
  });

  it("is aggregate-file layout (confirms adoption is not supported by design)", () => {
    expect(codexAdapter.layout).toBe("aggregate-file");
    // These hooks MUST be undefined for aggregate-file layout so mirror.ts's
    // adoption loop skips codex cleanly.
    expect(codexAdapter.listMirrorSkills).toBeUndefined();
    expect(codexAdapter.readMirrorSkill).toBeUndefined();
  });
});
