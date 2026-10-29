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
