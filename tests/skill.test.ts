import { describe, it, expect } from "vitest";
import {
  normalizeGeneratedSkillBody,
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

  it("parses missing tier as undefined (legacy compat)", () => {
    expect(parseSkillMd(VALID).frontmatter.tier).toBeUndefined();
  });

  it.each(["high", "medium", "low"] as const)("accepts tier=%s", (tier) => {
    const src = `---\nname: x\ndescription: y\ntier: ${tier}\n---\n\nbody`;
    expect(parseSkillMd(src).frontmatter.tier).toBe(tier);
  });

  it("rejects invalid tier value", () => {
    const src = `---\nname: x\ndescription: y\ntier: critical\n---\n\nbody`;
    expect(() => parseSkillMd(src)).toThrow(SkillValidationError);
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

describe("normalizeGeneratedSkillBody", () => {
  it("strips an orphan opening fence before generated skill markdown", () => {
    expect(normalizeGeneratedSkillBody("```\n\n# Heading\nBody")).toBe("# Heading\nBody");
  });

  it("strips a markdown wrapper around generated skill markdown", () => {
    expect(normalizeGeneratedSkillBody("```markdown\n# Heading\nBody\n```")).toBe("# Heading\nBody");
  });

  it("strips a bare wrapper around generated skill markdown", () => {
    expect(normalizeGeneratedSkillBody("```\n# Heading\n\nBody\n```")).toBe("# Heading\n\nBody");
  });

  it("keeps ordinary code blocks intact", () => {
    const body = "```sh\npnpm test\n```\n\nUse the output to decide the next step.";
    expect(normalizeGeneratedSkillBody(body)).toBe(body);
  });

  it("keeps bare code block bodies intact", () => {
    const body = "```\n# install deps\npnpm install\n```";
    expect(normalizeGeneratedSkillBody(body)).toBe(body);
  });
});
