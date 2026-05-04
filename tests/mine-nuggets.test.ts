import { describe, expect, it } from "vitest";
import { mergeNuggets } from "../src/mine/nuggets.js";
import type { Nugget } from "../src/mine/types.js";

function nugget(id: string, sessionId: string, confidence: number): Nugget {
  return {
    id,
    category: "preference",
    focus: "user-preference",
    signal: "Use focused tests",
    evidence: [
      {
        sessionId,
        project: "p",
        userMessage: `message ${sessionId}`,
      },
    ],
    confidence,
    source: "heuristic",
    createdAt: "2026-05-04T00:00:00.000Z",
  };
}

describe("mergeNuggets", () => {
  it("merges evidence and keeps stronger confidence", () => {
    const merged = mergeNuggets([nugget("n1", "s1", 0.5)], [nugget("n1", "s2", 0.8)]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.confidence).toBe(0.8);
    expect(merged[0]?.evidence.map((e) => e.sessionId)).toEqual(["s1", "s2"]);
  });
});
