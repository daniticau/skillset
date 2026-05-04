import { describe, expect, it } from "vitest";
import {
  balancedClusterOrder,
  cappedFocusCandidates,
  focusForCategory,
  isPrimaryFocus,
} from "../src/mine/focus.js";
import type { NuggetCluster, NuggetCategory } from "../src/mine/types.js";

function cluster(id: string, category: NuggetCategory, score: number): NuggetCluster {
  const nugget = {
    id,
    category,
    signal: id,
    evidence: [],
    confidence: 0.8,
    source: "heuristic" as const,
    createdAt: "2026-04-15T00:00:00.000Z",
    focus: focusForCategory(category),
  };
  return {
    id,
    canonical: nugget,
    focus: nugget.focus,
    members: [nugget],
    score,
    projects: [],
  };
}

describe("tailoring focus", () => {
  it("maps categories into the two primary tailoring lanes", () => {
    expect(focusForCategory("correction")).toBe("agent-mistake");
    expect(focusForCategory("rejection")).toBe("agent-mistake");
    expect(focusForCategory("anti-pattern")).toBe("agent-mistake");
    expect(focusForCategory("preference")).toBe("user-preference");
    expect(focusForCategory("style")).toBe("user-preference");
    expect(focusForCategory("workflow")).toBe("user-preference");
    expect(focusForCategory("topic")).toBe("other");
    expect(focusForCategory("tool-pattern")).toBe("other");
  });

  it("orders one mistake and one preference first when budget permits", () => {
    const ordered = balancedClusterOrder(
      [
        cluster("mistake-low", "correction", 0.7),
        cluster("pref-high", "preference", 0.95),
        cluster("pref-low", "style", 0.8),
        cluster("other-high", "topic", 1),
      ],
      2
    );

    expect(ordered.map((c) => c.id).slice(0, 2).sort()).toEqual([
      "mistake-low",
      "pref-high",
    ]);
    expect(ordered.every((c) => isPrimaryFocus(c.focus ?? "other"))).toBe(true);
  });

  it("caps focus candidates before filling by score", () => {
    const candidates = cappedFocusCandidates(
      [
        cluster("mistake-1", "correction", 0.9),
        cluster("mistake-2", "anti-pattern", 0.8),
        cluster("pref-1", "preference", 0.95),
        cluster("pref-2", "style", 0.85),
        cluster("pref-3", "workflow", 0.7),
      ],
      { mistakeCap: 1, preferenceCap: 1, fillCap: 1 }
    );

    expect(candidates.map((c) => c.id).sort()).toEqual([
      "mistake-1",
      "pref-1",
      "pref-2",
    ]);
  });
});
