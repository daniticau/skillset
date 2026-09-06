import { describe, it, expect } from "vitest";
import {
  ALWAYS_END,
  ALWAYS_START,
  readAlwaysBlock,
  renderAlwaysBlock,
  spliceAlwaysBlock,
} from "../src/core/adapters/always-block.js";
import type { ParsedSkill } from "../src/core/skill.js";

const rule = (name: string, body: string): ParsedSkill => ({
  frontmatter: { name, description: `d ${name}`, always: true },
  body,
});

describe("always-on block", () => {
  it("renders nothing for no skills", () => {
    expect(renderAlwaysBlock([])).toBe("");
  });

  it("uses the body H1 as the title and demotes the rest one level", () => {
    const out = renderAlwaysBlock([rule("writing", "# Writing rules\n\n## Orwell\n\n1. Cut words.\n")]);
    expect(out.startsWith(ALWAYS_START)).toBe(true);
    expect(out.trimEnd().endsWith(ALWAYS_END)).toBe(true);
    expect(out).toContain("## Writing rules");
    expect(out).toContain("<!-- skill: writing -->");
    expect(out).toContain("### Orwell");
    expect(out).not.toContain("\n# Writing rules");
  });

  it("falls back to the skill name when there is no H1, and sorts by name", () => {
    const out = renderAlwaysBlock([rule("zeta", "last"), rule("alpha", "first")]);
    expect(out.indexOf("## alpha")).toBeLessThan(out.indexOf("## zeta"));
  });

  it("leaves headings inside code fences alone", () => {
    const out = renderAlwaysBlock([rule("x", "text\n\n```\n# not a heading\n```\n")]);
    expect(out).toContain("\n# not a heading\n");
  });

  it("appends to a file with no block and keeps user text", () => {
    const block = renderAlwaysBlock([rule("r", "body")]);
    const next = spliceAlwaysBlock("# Mine\n\nkeep this\n", block);
    expect(next.startsWith("# Mine\n\nkeep this\n\n")).toBe(true);
    expect(readAlwaysBlock(next)).toBe(block.trimEnd());
  });

  it("replaces an existing block in place and preserves what surrounds it", () => {
    const v1 = renderAlwaysBlock([rule("r", "version-one")]);
    const v2 = renderAlwaysBlock([rule("r", "version-two")]);
    const file = `before\n\n${v1}\nafter\n`;
    const next = spliceAlwaysBlock(file, v2);
    expect(next).toBe(`before\n\n${v2}\nafter\n`);
    expect(next).not.toContain("version-one");
  });

  it("removes the block when there are no always-on skills left", () => {
    const v1 = renderAlwaysBlock([rule("r", "one")]);
    expect(spliceAlwaysBlock(`before\n\n${v1}\nafter\n`, "")).toBe("before\n\nafter\n");
    expect(spliceAlwaysBlock(v1, "")).toBe("");
    expect(spliceAlwaysBlock("untouched\n", "")).toBe("untouched\n");
  });
});
