import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import {
  extractSignal,
  collapseRejections,
  recencyWeight,
} from "../src/mine/extract.js";
import { projectName } from "../src/mine/reader.js";
import type { Nugget, ParsedSession } from "../src/mine/types.js";

function makeSession(
  sessionId: string,
  projectSlug: string,
  messages: Array<{
    role: "user" | "assistant";
    text: string;
    isToolResult?: boolean;
    isRejection?: boolean;
    toolUses?: string[];
    timestamp?: string;
  }>
): ParsedSession {
  return {
    sessionId,
    projectSlug,
    filePath: `/fake/${sessionId}.jsonl`,
    messages: messages.map((m) => ({
      role: m.role,
      text: m.text,
      isToolResult: m.isToolResult,
      isRejection: m.isRejection,
      toolUses: m.toolUses,
      timestamp: m.timestamp ?? new Date().toISOString(),
    })),
  };
}

describe("extractSignal", () => {
  it("extracts corrections from 'don't' patterns", () => {
    const session = makeSession("s1", "C--proj", [
      { role: "assistant", text: "I'll add a try-catch here." },
      { role: "user", text: "don't use try-catch, use Result types instead" },
    ]);
    const { nuggets } = extractSignal([session]);
    expect(nuggets.some((n) => n.category === "correction")).toBe(true);
  });

  it("extracts preferences from 'always use' patterns", () => {
    const session = makeSession("s1", "C--proj", [
      { role: "user", text: "always use pnpm instead of npm for this project" },
    ]);
    const { nuggets } = extractSignal([session]);
    expect(nuggets.some((n) => n.category === "preference")).toBe(true);
  });

  it("extracts style preferences", () => {
    const session = makeSession("s1", "C--proj", [
      { role: "user", text: "use tabs not spaces for indentation please" },
    ]);
    const { nuggets } = extractSignal([session]);
    const styleNugget = nuggets.find((n) => n.category === "style");
    expect(styleNugget).toBeDefined();
  });

  it("multi-turn correction gets higher confidence than single-message", () => {
    const session = makeSession("s1", "C--proj", [
      { role: "assistant", text: "Wrapping in try-catch." },
      { role: "user", text: "stop doing that, I told you to avoid exceptions" },
      { role: "assistant", text: "Understood, switching to Result." },
    ]);
    const { nuggets } = extractSignal([session]);
    const corrections = nuggets.filter((n) => n.category === "correction");
    // Should find both single-pass correction AND multi-turn
    expect(corrections.length).toBeGreaterThan(0);
    // Confidence should be at least 0.7 * some recency weight
    expect(corrections.some((n) => n.confidence > 0.5)).toBe(true);
  });

  it("filters out noise messages", () => {
    const session = makeSession("s1", "C--proj", [
      { role: "user", text: "<command-name>/commit</command-name>" },
      { role: "user", text: "<system-reminder>don't do anything</system-reminder>" },
    ]);
    const { nuggets } = extractSignal([session]);
    // These should NOT produce correction nuggets
    const withSystemText = nuggets.filter((n) =>
      n.signal.includes("<command-name>") || n.signal.includes("<system-reminder>")
    );
    expect(withSystemText.length).toBe(0);
  });

  it("filters out very short messages", () => {
    const session = makeSession("s1", "C--proj", [
      { role: "user", text: "don't" }, // too short
      { role: "user", text: "ok" },    // too short
    ]);
    const { nuggets } = extractSignal([session]);
    expect(nuggets.filter((n) => n.category === "correction")).toHaveLength(0);
  });

  it("applies recency weighting to confidence", () => {
    const oldTimestamp = new Date("2020-01-01").toISOString();
    const newTimestamp = new Date().toISOString();

    const oldSession = makeSession("old", "C--proj-a", [
      { role: "user", text: "always use TypeScript strict mode", timestamp: oldTimestamp },
    ]);
    const newSession = makeSession("new", "C--proj-b", [
      { role: "user", text: "always prefer pnpm for package management", timestamp: newTimestamp },
    ]);

    const { nuggets } = extractSignal([oldSession, newSession]);
    const oldNugget = nuggets.find((n) => n.signal.includes("strict mode"));
    const newNugget = nuggets.find((n) => n.signal.includes("pnpm"));
    expect(oldNugget).toBeDefined();
    expect(newNugget).toBeDefined();
    expect(newNugget!.confidence).toBeGreaterThan(oldNugget!.confidence);
  });

  it("adds source and createdAt to every nugget", () => {
    const session = makeSession("s1", "C--proj", [
      { role: "user", text: "always use const, never let for immutable data" },
    ]);
    const { nuggets } = extractSignal([session]);
    expect(nuggets.length).toBeGreaterThan(0);
    for (const n of nuggets) {
      expect(n.source).toBe("heuristic");
      expect(n.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });
});

describe("collapseRejections", () => {
  it("collapses duplicate tool rejections", () => {
    const now = new Date().toISOString();
    const rejections: Nugget[] = [
      {
        id: "abc123",
        category: "rejection",
        signal: "Rejected tool: mcp__paper__get_selection",
        evidence: [{ sessionId: "s1", project: "p1", userMessage: "no" }],
        confidence: 0.5,
        source: "heuristic",
        createdAt: now,
        occurrences: 1,
      },
      {
        id: "abc123",
        category: "rejection",
        signal: "Rejected tool: mcp__paper__get_selection",
        evidence: [{ sessionId: "s2", project: "p1", userMessage: "no" }],
        confidence: 0.5,
        source: "heuristic",
        createdAt: now,
        occurrences: 1,
      },
      {
        id: "abc123",
        category: "rejection",
        signal: "Rejected tool: mcp__paper__get_selection",
        evidence: [{ sessionId: "s3", project: "p2", userMessage: "no" }],
        confidence: 0.5,
        source: "heuristic",
        createdAt: now,
        occurrences: 1,
      },
    ];
    const collapsed = collapseRejections(rejections);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]!.occurrences).toBe(3);
    expect(collapsed[0]!.signal).toContain("3 times");
    expect(collapsed[0]!.crossProject).toBe(true);
  });
});

describe("projectName", () => {
  // Build paths using the real home dir so the reverse-mapping works on both
  // Windows and POSIX CI environments.
  const home = homedir();
  const j = (...parts: string[]): string =>
    [home, ...parts].join(home.includes("\\") ? "\\" : "/");

  it("uses cwd as ground truth — dev/ tail wins", () => {
    expect(projectName(j("dev", "aristotle-cli"))).toBe("aristotle-cli");
    expect(projectName(j("dev", "nia-cli"))).toBe("nia-cli");
    expect(projectName(j("dev", "personal-website"))).toBe("personal-website");
    expect(projectName(j("dev", "spotify-local-files-helper"))).toBe(
      "spotify-local-files-helper"
    );
  });

  it("labels home dir as 'home', not the username", () => {
    expect(projectName(home)).toBe("home");
  });

  it("does not collapse distinct projects with the same hyphen tail", () => {
    // This is the core bug: old code took last '-' token, merging all "*-cli".
    expect(projectName(j("dev", "aristotle-cli"))).not.toBe(
      projectName(j("dev", "nia-cli"))
    );
  });

  it("falls back to slug parsing when cwd is unavailable", () => {
    const homeSlug = home.replace(/[\\/:]/g, "-");
    expect(projectName(undefined, homeSlug)).toBe("home");
    expect(projectName(undefined, `${homeSlug}-dev-skillissue`)).toBe(
      "skillissue"
    );
  });

  it("returns 'unknown' when both cwd and slug are missing", () => {
    expect(projectName(undefined, undefined)).toBe("unknown");
  });
});

describe("recencyWeight", () => {
  const now = new Date("2026-04-15T00:00:00Z");
  it("returns ~1 for today", () => {
    const today = new Date("2026-04-15T00:00:00Z").toISOString();
    expect(recencyWeight(today, now)).toBeCloseTo(1, 1);
  });
  it("returns ~0.5 for 30 days ago", () => {
    const month = new Date("2026-03-16T00:00:00Z").toISOString();
    expect(recencyWeight(month, now)).toBeCloseTo(0.5, 1);
  });
  it("returns default for undefined", () => {
    expect(recencyWeight(undefined, now)).toBe(0.5);
  });
});
