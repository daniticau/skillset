import { describe, expect, it } from "vitest";
import {
  createDirectSkillCluster,
  inferDirectSkillCategory,
} from "../src/mine/direct-skill.js";

describe("direct skill requests", () => {
  it("turns explicit user text into a synthetic cluster", () => {
    const cluster = createDirectSkillCluster("Always use pnpm for package installs");

    expect(cluster.id).toMatch(/^direct-[a-f0-9]{16}$/);
    expect(cluster.score).toBe(1);
    expect(cluster.projects).toEqual(["manual"]);
    expect(cluster.canonical.signal).toBe("Always use pnpm for package installs");
    expect(cluster.canonical.confidence).toBe(1);
    expect(cluster.canonical.evidence[0]?.sessionId).toBe("manual-skill-request");
  });

  it("infers useful categories from request wording", () => {
    expect(inferDirectSkillCategory("Never add broad fallbacks")).toBe("anti-pattern");
    expect(inferDirectSkillCategory("Before commits, run pnpm test")).toBe("workflow");
    expect(inferDirectSkillCategory("Use tabs for indentation style")).toBe("style");
    expect(inferDirectSkillCategory("Use rg instead of grep")).toBe("tool-pattern");
    expect(inferDirectSkillCategory("Prefer short final answers")).toBe("preference");
  });
});
