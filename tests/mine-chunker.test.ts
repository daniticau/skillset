import { describe, it, expect } from "vitest";
import { chunkSession, estimateTokens } from "../src/mine/chunker.js";
import type { ParsedSession, Nugget } from "../src/mine/types.js";

function makeSession(count: number): ParsedSession {
  const msgs: ParsedSession["messages"] = [];
  for (let i = 0; i < count; i++) {
    msgs.push({
      role: i % 2 === 0 ? "user" : "assistant",
      text:
        i % 2 === 0
          ? `User message number ${i} with enough text to be meaningful content here`
          : `Assistant reply number ${i}`,
    });
  }
  return {
    sessionId: "s1",
    projectSlug: "C--proj",
    filePath: "/fake.jsonl",
    messages: msgs,
  };
}

describe("estimateTokens", () => {
  it("rough approximation works", () => {
    expect(estimateTokens("hello")).toBeGreaterThan(0);
    expect(estimateTokens("a".repeat(700))).toBeGreaterThan(estimateTokens("hello"));
  });
});

describe("chunkSession", () => {
  it("returns empty array for empty session", () => {
    const session: ParsedSession = {
      sessionId: "s1",
      projectSlug: "C--proj",
      filePath: "/fake.jsonl",
      messages: [],
    };
    expect(chunkSession(session, [])).toEqual([]);
  });

  it("builds windows around heuristic hits", () => {
    const session = makeSession(20);
    // Make a fake nugget pointing to message index 8 (user)
    const targetText = session.messages[8]!.text;
    const nugget: Nugget = {
      id: "n1",
      category: "correction",
      signal: targetText,
      evidence: [
        {
          sessionId: "s1",
          project: "proj",
          userMessage: targetText,
        },
      ],
      confidence: 0.8,
      source: "heuristic",
      createdAt: new Date().toISOString(),
    };
    const windows = chunkSession(session, [nugget]);
    expect(windows.length).toBeGreaterThan(0);
    const hit = windows.find((w) => w.heuristicHits.includes("correction"));
    expect(hit).toBeDefined();
  });

  it("samples windows when no heuristic hits", () => {
    const session = makeSession(10);
    const windows = chunkSession(session, []);
    // Should still produce some windows via fallback path
    expect(windows.length).toBeGreaterThan(0);
  });

  it("respects maxWindowsPerSession", () => {
    const session = makeSession(100);
    const windows = chunkSession(session, [], { maxWindowsPerSession: 3 });
    expect(windows.length).toBeLessThanOrEqual(3);
  });
});
