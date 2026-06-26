import { describe, expect, it, vi } from "vitest";
import type { NuggetCluster } from "../src/mine/types.js";

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
}));

vi.mock("../src/mine/llm/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/mine/llm/index.js")>();
  return {
    ...actual,
    chat: mocks.chat,
    parseLLMJson: (raw: string) => JSON.parse(raw),
  };
});

const { planSkillAction } = await import("../src/mine/make.js");
const { createDirectSkillCluster } = await import("../src/mine/direct-skill.js");
const { validateSkillName } = await import("../src/core/skill.js");

function cluster(overrides: Partial<NuggetCluster> = {}): NuggetCluster {
  const signal = "I liked how you handled that task";
  const nugget = {
    id: "n1",
    category: "preference" as const,
    signal,
    evidence: [{ sessionId: "s1", project: "app", userMessage: signal }],
    confidence: 0.7,
    source: "heuristic" as const,
    createdAt: "2026-05-01T00:00:00.000Z",
  };
  return {
    id: "c1",
    canonical: nugget,
    members: [nugget],
    score: 0.62,
    projects: ["app"],
    ...overrides,
  };
}

describe("planSkillAction quality gate", () => {
  it("converts thin CREATE actions into SKIP", async () => {
    mocks.chat.mockResolvedValueOnce({
      content: JSON.stringify({
        kind: "create",
        name: "task-handling-style",
        description: "Capture vague task handling taste.",
        tier: "low",
      }),
    });

    const action = await planSkillAction(
      cluster(),
      [],
      { provider: "ollama", model: "m", baseUrl: "", timeout: 1, maxRetries: 0 },
      1
    );

    expect(action.kind).toBe("skip");
    expect(action.kind === "skip" ? action.reason : "").toContain("create quality gate");
  });

  it("preserves manual capture CREATE actions", async () => {
    mocks.chat.mockResolvedValueOnce({
      content: JSON.stringify({
        kind: "create",
        name: "prefer-pnpm",
        description: "Prefer pnpm for package management.",
        tier: "high",
      }),
    });

    const action = await planSkillAction(
      createDirectSkillCluster("Always use pnpm for package management."),
      [],
      { provider: "ollama", model: "m", baseUrl: "", timeout: 1, maxRetries: 0 },
      1
    );

    expect(action).toMatchObject({
      kind: "create",
      name: "prefer-pnpm",
      tier: "high",
    });
  });

  it("converts CREATE name collisions to EDIT before applying create quality gates", async () => {
    mocks.chat.mockResolvedValueOnce({
      content: JSON.stringify({
        kind: "create",
        name: "existing-skill",
        description: "Duplicate name.",
        tier: "low",
      }),
    });

    const action = await planSkillAction(
      cluster(),
      [{ name: "existing-skill", description: "Already covers this." }],
      { provider: "ollama", model: "m", baseUrl: "", timeout: 1, maxRetries: 0 },
      0
    );

    expect(action).toMatchObject({
      kind: "edit",
      targetName: "existing-skill",
    });
  });

  it("trims generated names to a still-valid skill slug", async () => {
    mocks.chat.mockResolvedValueOnce({
      content: JSON.stringify({
        kind: "create",
        name: "a ".repeat(31),
        description: "Use when testing long generated skill names.",
        tier: "medium",
      }),
    });

    const action = await planSkillAction(
      createDirectSkillCluster("Always test long generated skill names."),
      [],
      { provider: "ollama", model: "m", baseUrl: "", timeout: 1, maxRetries: 0 },
      1
    );

    expect(action.kind).toBe("create");
    if (action.kind !== "create") return;
    expect(action.name.endsWith("-")).toBe(false);
    expect(() => validateSkillName(action.name)).not.toThrow();
  });
});
