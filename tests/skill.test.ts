import { describe, it, expect } from "vitest";
import {
  parseSkillMd,
  renderSkillMd,
  SkillValidationError,
  validateSkillName,
} from "../src/core/skill.js";

const VALID = `---
name: example
description: Does a thing when the user asks for a thing.
---

# Example
Body goes here.
`;

describe("parseSkillMd", () => {
  it("parses valid SKILL.md", () => {
    const parsed = parseSkillMd(VALID);
    expect(parsed.frontmatter.name).toBe("example");
    expect(parsed.frontmatter.description).toMatch(/Does a thing/);
    expect(parsed.body).toContain("Body goes here.");
  });

  it("rejects missing name", () => {
    const src = `---\ndescription: x\n---\n\nbody`;
    expect(() => parseSkillMd(src)).toThrow(SkillValidationError);
  });

  it("rejects missing description", () => {
    const src = `---\nname: x\n---\n\nbody`;
    expect(() => parseSkillMd(src)).toThrow(SkillValidationError);
  });

  it("ignores a legacy tier field", () => {
    const src = `---\nname: x\ndescription: y\ntier: critical\n---\n\nbody`;
    expect(parseSkillMd(src).frontmatter).toEqual({ name: "x", description: "y" });
  });

  it.each(["../escape", "bad/name", "BadName", "-leading", "trailing-", "two--hyphens"])(
    "rejects unsafe skill name %s",
    (name) => {
      const src = `---\nname: ${JSON.stringify(name)}\ndescription: y\n---\n\nbody`;
      expect(() => parseSkillMd(src)).toThrow(SkillValidationError);
    }
  );
});

describe("skill names", () => {
  it("accepts ordinary kebab-case skill names", () => {
    expect(() => validateSkillName("ios-prep-skill")).not.toThrow();
    expect(() => validateSkillName("skill2")).not.toThrow();
  });

  it("rejects unsafe path-like names before rendering", () => {
    expect(() =>
      renderSkillMd({ name: "../escape", description: "bad" }, "body")
    ).toThrow(SkillValidationError);
  });
});

describe("category and kind frontmatter", () => {
  const base = "---\nname: x\ndescription: Use when testing.\n";

  it("reads a category and a kind and renders them back", () => {
    const parsed = parseSkillMd(`${base}category: "  Design   Systems "\nkind: Judgement\n---\n\nBody.\n`);
    expect(parsed.frontmatter.category).toBe("Design Systems");
    expect(parsed.frontmatter.kind).toBe("judgement");
    const rendered = renderSkillMd(parsed.frontmatter, parsed.body);
    expect(rendered).toContain('category: "Design Systems"');
    expect(rendered).toContain("kind: judgement");
    expect(parseSkillMd(rendered).frontmatter).toMatchObject({ category: "Design Systems", kind: "judgement" });
  });

  it("ignores values it cannot use instead of rejecting the skill", () => {
    const parsed = parseSkillMd(`${base}category: [a, b]\nkind: recipe\n---\n\nBody.\n`);
    expect(parsed.frontmatter.category).toBeUndefined();
    expect(parsed.frontmatter.kind).toBeUndefined();
  });
});
