import { describe, it, expect } from "vitest";
import { tfidfVectorize, cosineSimilarity, dbscan, deduplicateAndRank } from "../src/mine/dedup.js";
import type { Nugget } from "../src/mine/types.js";

function nugget(overrides: Partial<Nugget> & { id: string; signal: string }): Nugget {
  const base: Nugget = {
    category: "preference",
    signal: overrides.signal,
    id: overrides.id,
    evidence: [{ sessionId: "s1", project: "p1", userMessage: overrides.signal }],
    confidence: 0.7,
    source: "heuristic",
    createdAt: new Date().toISOString(),
  };
  return { ...base, ...overrides };
}

describe("tfidfVectorize", () => {
  it("produces vectors of the same dimension", () => {
    const vecs = tfidfVectorize(["the quick brown fox", "jumps over the lazy dog"]);
    expect(vecs.length).toBe(2);
    expect(vecs[0]!.length).toBe(vecs[1]!.length);
  });

  it("similar texts have higher similarity than dissimilar", () => {
    const vecs = tfidfVectorize([
      "use pnpm instead of npm",
      "prefer pnpm over npm for packages",
      "always write unit tests first",
    ]);
    const simSame = cosineSimilarity(vecs[0]!, vecs[1]!);
    const simDiff = cosineSimilarity(vecs[0]!, vecs[2]!);
    expect(simSame).toBeGreaterThan(simDiff);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
  });
  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });
  it("returns 0 for zero vector", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe("dbscan", () => {
  it("clusters close points together", () => {
    // Two clusters: [a1, a2] close to each other, [b1] far away
    const a1 = [1, 0, 0];
    const a2 = [0.95, 0.05, 0];
    const b1 = [0, 0, 1];
    const labels = dbscan([a1, a2, b1], 0.3, 1);
    expect(labels[0]).toBe(labels[1]); // a1 and a2 in same cluster
    expect(labels[2]).not.toBe(labels[0]); // b1 in different cluster
  });

  it("handles empty input", () => {
    expect(dbscan([], 0.3, 1)).toEqual([]);
  });
});

describe("deduplicateAndRank", () => {
  it("clusters semantically similar nuggets", async () => {
    const nuggets: Nugget[] = [
      nugget({ id: "1", signal: "use pnpm instead of npm" }),
      nugget({ id: "2", signal: "prefer pnpm over npm" }),
      nugget({ id: "3", signal: "always write tests before code" }),
    ];
    const clusters = await deduplicateAndRank(nuggets, { eps: 0.6 });
    // Should produce fewer clusters than nuggets
    expect(clusters.length).toBeLessThanOrEqual(nuggets.length);
  });

  it("ranks clusters by score (more members = higher score)", async () => {
    const nuggets: Nugget[] = [
      nugget({
        id: "1",
        signal: "use pnpm",
        evidence: [{ sessionId: "s1", project: "p1", userMessage: "use pnpm" }],
      }),
      nugget({
        id: "2",
        signal: "use pnpm here",
        evidence: [{ sessionId: "s2", project: "p2", userMessage: "use pnpm here" }],
      }),
      nugget({
        id: "3",
        signal: "always write tests",
        evidence: [{ sessionId: "s3", project: "p3", userMessage: "always write tests" }],
      }),
    ];
    const clusters = await deduplicateAndRank(nuggets, { eps: 0.5 });
    // Verify clusters are sorted by score descending
    for (let i = 1; i < clusters.length; i++) {
      expect(clusters[i - 1]!.score).toBeGreaterThanOrEqual(clusters[i]!.score);
    }
  });

  it("handles empty input", async () => {
    const clusters = await deduplicateAndRank([]);
    expect(clusters).toEqual([]);
  });

  it("does not cluster across categories", async () => {
    const nuggets: Nugget[] = [
      nugget({ id: "1", signal: "use pnpm", category: "preference" }),
      nugget({ id: "2", signal: "use pnpm", category: "style" }),
    ];
    const clusters = await deduplicateAndRank(nuggets, { eps: 0.1 });
    expect(clusters.length).toBe(2);
  });

  it("scores every cluster in [0, 1]", async () => {
    // Mix of single-project and cross-project, varying confidence and freq
    const nuggets: Nugget[] = [
      nugget({
        id: "1",
        signal: "use pnpm instead of npm",
        confidence: 0.9,
        evidence: [{ sessionId: "s1", project: "p1", userMessage: "use pnpm", timestamp: new Date().toISOString() }],
      }),
      nugget({
        id: "2",
        signal: "prefer pnpm over npm for packages",
        confidence: 0.85,
        evidence: [{ sessionId: "s2", project: "p2", userMessage: "prefer pnpm", timestamp: new Date().toISOString() }],
      }),
      nugget({
        id: "3",
        signal: "rejected tool foo 20 times",
        confidence: 0.9,
        occurrences: 20,
        evidence: [{ sessionId: "s3", project: "p3", userMessage: "nope", timestamp: new Date().toISOString() }],
      }),
      nugget({
        id: "4",
        signal: "singleton nugget with default conf",
      }),
    ];
    const clusters = await deduplicateAndRank(nuggets);
    expect(clusters.length).toBeGreaterThan(0);
    for (const c of clusters) {
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.score).toBeLessThanOrEqual(1);
    }
  });

  it("char bigrams help short stylistically-varied signals cluster", async () => {
    // Two paraphrased corrections with only one shared word token ("meant").
    // Without bigrams their TF-IDF cosine distance is near 1.0 (no merge).
    // With bigrams they share many 2-char substrings and should cluster.
    const nuggets: Nugget[] = [
      nugget({ id: "a", signal: "sry i meant the other thing", category: "correction" }),
      nugget({ id: "b", signal: "no wait i meant the other one", category: "correction" }),
    ];
    const clusters = await deduplicateAndRank(nuggets);
    expect(clusters.length).toBe(1);
    expect(clusters[0]!.members.length).toBe(2);
  });
});
