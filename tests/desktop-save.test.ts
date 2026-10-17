import { describe, expect, it } from "vitest";
import { parseDesktopCreate, parseDesktopSave, splitSkillMarkdown } from "../src/commands/desktop.js";

describe("desktop save payload", () => {
  it("keeps only the fields the app sent", () => {
    expect(parseDesktopSave('{"name":"a","body":"# A"}')).toEqual({
      name: "a",
      rename: undefined,
      description: undefined,
      body: "# A",
    });
  });

  it("rejects a payload without a name or with a non-string field", () => {
    expect(() => parseDesktopSave('{"body":"x"}')).toThrow("missing name");
    expect(() => parseDesktopSave('{"name":"a","rename":3}')).toThrow("rename must be a string");
    expect(() => parseDesktopSave("[]")).toThrow();
  });
});

describe("desktop parse", () => {
  it("splits a pasted SKILL.md into its fields", () => {
    const raw = "---\nname: tidy-commits\ndescription: >-\n  Use when committing.\n  Keep it short.\nalways: true\n---\n\n# Tidy commits\n\nOne idea per commit.\n";
    expect(splitSkillMarkdown(raw)).toEqual({
      name: "tidy-commits",
      description: "Use when committing. Keep it short.",
      always: true,
      body: "# Tidy commits\n\nOne idea per commit.",
    });
  });

  it("returns plain Markdown and broken frontmatter as body only", () => {
    expect(splitSkillMarkdown("# Just a body")).toEqual({ body: "# Just a body" });
    const broken = "---\nname: [unclosed\n---\nbody";
    expect(splitSkillMarkdown(broken)).toEqual({ body: broken });
  });
});

describe("desktop create payload", () => {
  it("needs a name and a description", () => {
    expect(parseDesktopCreate('{"name":"a","description":" d ","body":"b"}')).toEqual({
      name: "a",
      description: "d",
      body: "b",
      always: false,
    });
    expect(() => parseDesktopCreate('{"name":"a","body":"b"}')).toThrow("missing description");
    expect(() => parseDesktopCreate('{"description":"d"}')).toThrow("missing name");
    expect(() => parseDesktopCreate('{"name":"a","description":"d","always":"yes"}')).toThrow(
      "always must be a boolean"
    );
  });
});
