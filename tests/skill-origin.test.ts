import { describe, it, expect } from "vitest";
import {
  parseSkillMd,
  renderSkillMd,
  SkillValidationError,
  SKILL_ORIGINS,
} from "../src/core/skill.js";
import { migrateState, initialSkillState } from "../src/core/config.js";

describe("SkillFrontmatter origin", () => {
  it.each(SKILL_ORIGINS)("parses origin=%s", (origin) => {
    const src = `---\nname: x\ndescription: y\norigin: ${origin}\n---\n\nbody`;
    expect(parseSkillMd(src).frontmatter.origin).toBe(origin);
  });

  it("missing origin is undefined (legacy compat)", () => {
    const src = `---\nname: x\ndescription: y\n---\n\nbody`;
    expect(parseSkillMd(src).frontmatter.origin).toBeUndefined();
  });

  it("rejects invalid origin value", () => {
    const src = `---\nname: x\ndescription: y\norigin: mystery\n---\n\nbody`;
    expect(() => parseSkillMd(src)).toThrow(SkillValidationError);
  });

  it("renderSkillMd round-trips origin + tier + license in stable order", () => {
    const rendered = renderSkillMd(
      {
        name: "demo",
        description: "A test",
        tier: "medium",
        origin: "auto-created",
        license: "MIT",
      },
      "body here"
    );
    expect(rendered).toMatch(/^---\nname: demo\ndescription: "A test"\ntier: medium\norigin: auto-created\nlicense: "MIT"\n---\n\nbody here\n$/);
    const parsed = parseSkillMd(rendered);
    expect(parsed.frontmatter).toEqual({
      name: "demo",
      description: "A test",
      tier: "medium",
      origin: "auto-created",
      license: "MIT",
    });
  });

  it("renderSkillMd omits undefined optional fields", () => {
    const rendered = renderSkillMd(
      { name: "demo", description: "A test" },
      "body"
    );
    expect(rendered).not.toContain("tier:");
    expect(rendered).not.toContain("origin:");
    expect(rendered).not.toContain("license:");
  });
});

describe("migrateState v1 → v2", () => {
  it("migrates v1 state shape to v2 with conservative origin default", () => {
    const v1 = {
      version: 1,
      skills: {
        alpha: {
          canonicalHash: "abc",
          mirrorHashes: { "claude-code:/p": "def" },
          userModified: true,
        },
        beta: {
          canonicalHash: "xyz",
          mirrorHashes: {},
          userModified: false,
        },
      },
    };
    const migrated = migrateState(v1);
    expect(migrated.version).toBe(2);
    expect(migrated.skills.alpha).toMatchObject({
      canonicalHash: "abc",
      userEdited: true,
      origin: "user-created",
    });
    expect(typeof migrated.skills.alpha?.createdAt).toBe("string");
    expect(migrated.skills.beta?.userEdited).toBe(false);
    expect(migrated.skills.beta?.origin).toBe("user-created");
  });

  it("preserves userEdited when state is already v2", () => {
    const v2 = {
      version: 2,
      skills: {
        gamma: {
          canonicalHash: "g",
          mirrorHashes: {},
          userEdited: true,
          origin: "auto-created",
          createdAt: "2026-01-01T00:00:00Z",
        },
      },
    };
    const migrated = migrateState(v2);
    expect(migrated.skills.gamma).toMatchObject({
      userEdited: true,
      origin: "auto-created",
      createdAt: "2026-01-01T00:00:00Z",
    });
  });

  it("migrateState on empty/invalid input returns default v2 state", () => {
    expect(migrateState(null).version).toBe(2);
    expect(migrateState({}).version).toBe(2);
    expect(migrateState("nonsense").version).toBe(2);
  });

  it("preserves conflictHistory from v1", () => {
    const v1 = {
      version: 1,
      skills: {
        alpha: {
          canonicalHash: "h",
          mirrorHashes: {},
          userModified: false,
          conflictHistory: [
            { at: "2026-04-10T00:00:00Z", winnerAdapter: "codex:/p", loserCount: 1 },
          ],
        },
      },
    };
    const migrated = migrateState(v1);
    expect(migrated.skills.alpha?.conflictHistory).toHaveLength(1);
  });

  it("initialSkillState seeds origin + createdAt + userEdited=false", () => {
    const s = initialSkillState("auto-created", { createdBy: "deep-dive" });
    expect(s.origin).toBe("auto-created");
    expect(s.userEdited).toBe(false);
    expect(s.createdBy).toBe("deep-dive");
    expect(typeof s.createdAt).toBe("string");
    expect(s.canonicalHash).toBe("");
    expect(s.mirrorHashes).toEqual({});
  });
});
