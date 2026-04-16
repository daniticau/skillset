import { describe, it, expect } from "vitest";
import { parseSkillMd, SkillValidationError } from "../src/core/skill.js";

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
});
