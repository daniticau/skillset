import { describe, expect, it } from "vitest";
import { createDirectSkillCluster } from "../src/mine/direct-skill.js";
import { assessClusterForCreate, describeClusterQuality } from "../src/mine/quality.js";
import type { Nugget, NuggetCluster } from "../src/mine/types.js";

function nugget(overrides: Partial<Nugget> = {}): Nugget {
  return {
    id: overrides.id ?? "n1",
    category: overrides.category ?? "preference",
    signal: overrides.signal ?? "I liked how you handled this task",
    evidence: overrides.evidence ?? [
      {
        sessionId: "s1",
        project: "app",
        userMessage: overrides.signal ?? "I liked how you handled this task",
      },
    ],
    confidence: overrides.confidence ?? 0.7,
    source: overrides.source ?? "heuristic",
    createdAt: overrides.createdAt ?? "2026-05-01T00:00:00.000Z",
    focus: overrides.focus,
    project: overrides.project,
    validatedByLLM: overrides.validatedByLLM,
    crossProject: overrides.crossProject,
    occurrences: overrides.occurrences,
  };
}

function cluster(members: Nugget[], score = 0.7): NuggetCluster {
  return {
    id: "c1",
    canonical: members[0]!,
    members,
    score,
    projects: [...new Set(members.flatMap((n) => n.evidence.map((ev) => ev.project)))],
  };
}

describe("cluster quality", () => {
  it("allows manual captures even when they are singletons", () => {
    const direct = createDirectSkillCluster("Always use pnpm for package management.");

    expect(assessClusterForCreate(direct).allowCreate).toBe(true);
    expect(describeClusterQuality(direct)).toContain("manual");
  });

  it("blocks thin singleton creates from mined history", () => {
    const c = cluster([nugget()], 0.62);

    const assessment = assessClusterForCreate(c);

    expect(assessment.allowCreate).toBe(false);
    expect(assessment.reason).toContain("needs repeated evidence");
  });

  it("allows repeated single-project evidence", () => {
    const c = cluster([
      nugget({ id: "n1", signal: "Always use pnpm", confidence: 0.8 }),
      nugget({ id: "n2", signal: "Always use pnpm", confidence: 0.75 }),
    ]);

    expect(assessClusterForCreate(c).allowCreate).toBe(true);
  });

  it("allows contextual corrections without requiring repetition", () => {
    const c = cluster([
      nugget({
        category: "correction",
        signal: "don't add fallbacks for impossible states",
        confidence: 0.7,
        evidence: [
          {
            sessionId: "s1",
            project: "app",
            userMessage: "don't add fallbacks for impossible states",
            context: "[assistant did]: added a fallback",
          },
        ],
      }),
    ]);

    expect(assessClusterForCreate(c).allowCreate).toBe(true);
  });
});
