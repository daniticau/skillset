/**
 * Semantic deduplication and ranking for nuggets.
 *
 * Pipeline:
 *   vectorize (TF-IDF or embeddings) → DBSCAN clustering → rank by score → canonical nugget per cluster.
 *
 * Pure TypeScript, no external ML dependencies. The dataset is small (hundreds
 * of nuggets), so O(n²) operations are fine.
 */

import { createHash } from "node:crypto";
import type { Nugget, NuggetCluster } from "./types.js";
import type { LLMConfig } from "./llm/index.js";
import { embed } from "./llm/index.js";

// ---------- TF-IDF ----------

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "to", "of", "and", "or", "in", "on", "at", "for", "with", "from",
  "this", "that", "these", "those", "it", "its", "as", "by",
  "i", "you", "he", "she", "we", "they", "them",
  "do", "does", "did", "not", "no",
  "my", "your", "our", "their",
  "have", "has", "had", "will", "would", "should", "could",
  "so", "but", "if", "than", "then",
]);

/**
 * Tokenize for TF-IDF. Returns word tokens (stopword-filtered) PLUS character
 * bigrams of the normalized string.
 *
 * Char bigrams matter for short, stylistically-varied signals — e.g. a user
 * correction like "sry i meant for new work" vs "no wait I meant this instead"
 * shares only one word token ("meant") but many char bigrams, producing a
 * meaningful similarity instead of near-zero cosine.
 */
function tokenize(text: string): string[] {
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const words = normalized
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));

  const bigrams: string[] = [];
  const collapsed = normalized.replace(/\s+/g, " ").trim();
  for (let i = 0; i < collapsed.length - 1; i++) {
    const b = collapsed.slice(i, i + 2);
    if (b.trim().length === 2) bigrams.push(`#${b}`); // prefix to keep distinct from word tokens
  }

  return [...words, ...bigrams];
}

/** Build a TF-IDF matrix: rows = docs, cols = vocabulary. */
export function tfidfVectorize(texts: string[]): number[][] {
  const tokenizedDocs = texts.map(tokenize);
  const vocab = new Map<string, number>();
  const df = new Map<string, number>();

  for (const doc of tokenizedDocs) {
    const seen = new Set<string>();
    for (const tok of doc) {
      if (!vocab.has(tok)) vocab.set(tok, vocab.size);
      if (!seen.has(tok)) {
        df.set(tok, (df.get(tok) ?? 0) + 1);
        seen.add(tok);
      }
    }
  }

  const N = texts.length;
  const vectors: number[][] = [];

  for (const doc of tokenizedDocs) {
    const vec = new Array<number>(vocab.size).fill(0);
    const tf = new Map<string, number>();
    for (const tok of doc) tf.set(tok, (tf.get(tok) ?? 0) + 1);

    for (const [tok, count] of tf) {
      const idx = vocab.get(tok);
      if (idx == null) continue;
      const idf = Math.log((N + 1) / ((df.get(tok) ?? 0) + 1)) + 1;
      vec[idx] = (count / doc.length) * idf;
    }

    // L2 normalize
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    for (let i = 0; i < vec.length; i++) vec[i]! /= norm;

    vectors.push(vec);
  }

  return vectors;
}

// ---------- Cosine similarity ----------

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ---------- DBSCAN ----------

/**
 * DBSCAN clustering. Returns labels array (same length as vectors),
 * where label -1 means noise (not in any cluster).
 */
export function dbscan(
  vectors: number[][],
  eps: number,
  minPts: number
): number[] {
  const n = vectors.length;
  const labels = new Array<number>(n).fill(-1);
  const visited = new Array<boolean>(n).fill(false);
  let clusterId = 0;

  // Distance = 1 - cosine_similarity (so eps is a distance threshold)
  const distance = (i: number, j: number): number =>
    1 - cosineSimilarity(vectors[i]!, vectors[j]!);

  const regionQuery = (i: number): number[] => {
    const neighbors: number[] = [];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (distance(i, j) <= eps) neighbors.push(j);
    }
    return neighbors;
  };

  for (let i = 0; i < n; i++) {
    if (visited[i]) continue;
    visited[i] = true;
    const neighbors = regionQuery(i);

    if (neighbors.length + 1 < minPts) {
      labels[i] = -1;
      continue;
    }

    labels[i] = clusterId;
    const seeds = [...neighbors];
    while (seeds.length > 0) {
      const j = seeds.shift()!;
      if (!visited[j]) {
        visited[j] = true;
        const jNeighbors = regionQuery(j);
        if (jNeighbors.length + 1 >= minPts) {
          for (const k of jNeighbors) {
            if (!seeds.includes(k)) seeds.push(k);
          }
        }
      }
      if (labels[j] === -1) labels[j] = clusterId;
    }

    clusterId++;
  }

  return labels;
}

// ---------- Ranking ----------

/**
 * Cluster score in `[0, 1]` — a weighted sum of four bounded factors.
 *
 * Weights (recency-biased — recent behavior dominates):
 *   0.30 freqNorm     — a pattern is a pattern because it repeats
 *   0.25 avgConf      — extractor's own confidence in the signal
 *   0.35 recency      — bias toward current behavior; 14-day half-life
 *   0.10 crossProj    — bonus for multi-project patterns, not load-bearing
 *
 * freqNorm uses the saturating curve `1 - exp(-effectiveFreq / 3)` so a single
 * occurrence is still scored (≈0.28) while high-volume signals plateau near 1.
 * `effectiveFreq` respects pre-collapsed nuggets: a rejection with
 * `occurrences=20` scores as frequency 20, not 1.
 */
function computeScore(members: Nugget[], now: Date): number {
  const avgConf = members.reduce((s, m) => s + m.confidence, 0) / members.length;

  const effectiveFreq = members.reduce(
    (s, m) => s + Math.max(1, m.occurrences ?? 1),
    0
  );
  const freqNorm = 1 - Math.exp(-effectiveFreq / 3);

  // Recency: use the most recent evidence timestamp if available.
  // Default 0.5 when no timestamps exist (e.g. tool-pattern aggregates).
  // Half-life tightened to 14 days — recent behavior should dominate.
  const timestamps = members
    .flatMap((m) => m.evidence.map((e) => e.timestamp))
    .filter((t): t is string => typeof t === "string");
  let recency = 0.5;
  if (timestamps.length > 0) {
    const latest = Math.max(
      ...timestamps.map((t) => Date.parse(t)).filter((n) => !Number.isNaN(n))
    );
    if (latest > 0) {
      const daysAgo = (now.getTime() - latest) / (1000 * 60 * 60 * 24);
      recency = 1 / (1 + Math.max(0, daysAgo) / 14);
    }
  }

  const projects = new Set(
    members.flatMap((m) => m.evidence.map((e) => e.project)).filter((p) => p)
  );
  const crossProjNorm = projects.size > 1 ? 1.0 : 0.5;

  return (
    0.30 * freqNorm +
    0.25 * avgConf +
    0.35 * recency +
    0.10 * crossProjNorm
  );
}

function pickCanonical(members: Nugget[]): Nugget {
  // Highest confidence; prefer LLM-validated; prefer shorter signal text (more distilled)
  return [...members].sort((a, b) => {
    if (a.validatedByLLM !== b.validatedByLLM) return a.validatedByLLM ? -1 : 1;
    const c = b.confidence - a.confidence;
    if (Math.abs(c) > 0.05) return c;
    return a.signal.length - b.signal.length;
  })[0]!;
}

// ---------- Main entry ----------

export interface DedupOptions {
  /**
   * Distance threshold for DBSCAN. Defaults depend on vectorizer:
   *   embeddings → 0.25 (tight — semantic vectors have clean separation)
   *   TF-IDF+bigrams → 0.55 (loose — distances are inherently larger)
   */
  eps?: number;
  minPts?: number; // minimum cluster size (default 1 — allow singletons)
  useEmbeddings?: boolean;
  llmConfig?: LLMConfig;
  now?: Date;
}

/**
 * Deduplicate nuggets by semantic similarity and rank the resulting clusters.
 * Returns one NuggetCluster per cluster (including singletons).
 */
export async function deduplicateAndRank(
  nuggets: Nugget[],
  options: DedupOptions = {}
): Promise<NuggetCluster[]> {
  if (nuggets.length === 0) return [];

  const minPts = options.minPts ?? 1;
  const now = options.now ?? new Date();

  // Don't cluster cross-category. Run DBSCAN per category so e.g.
  // a "style" and a "preference" with similar wording don't collapse.
  const byCategory = new Map<string, Nugget[]>();
  for (const n of nuggets) {
    const bucket = byCategory.get(n.category) ?? [];
    bucket.push(n);
    byCategory.set(n.category, bucket);
  }

  const clusters: NuggetCluster[] = [];

  for (const [category, bucket] of byCategory) {
    const texts = bucket.map((n) => n.signal);

    let vectors: number[][];
    let usedEmbeddings = false;
    if (options.useEmbeddings && options.llmConfig?.embeddingModel) {
      try {
        const results = await embed(options.llmConfig, texts);
        vectors = results.map((r) => r.vector);
        usedEmbeddings = true;
      } catch {
        vectors = tfidfVectorize(texts);
      }
    } else {
      vectors = tfidfVectorize(texts);
    }

    // eps is vectorizer-specific. User-supplied eps takes precedence.
    const eps = options.eps ?? (usedEmbeddings ? 0.25 : 0.55);

    // For minPts=1, DBSCAN returns a real cluster id for every point
    const labels = dbscan(vectors, eps, Math.max(1, minPts));

    const groups = new Map<number, Nugget[]>();
    labels.forEach((label, i) => {
      const key = label === -1 ? -1 - i : label; // singletons get unique id
      const group = groups.get(key) ?? [];
      group.push(bucket[i]!);
      groups.set(key, group);
    });

    for (const [, members] of groups) {
      if (members.length === 0) continue;
      const canonical = pickCanonical(members);
      const projects = [
        ...new Set(
          members.flatMap((m) => m.evidence.map((e) => e.project)).filter((p) => p)
        ),
      ];
      const clusterId = createHash("sha256")
        .update(`${category}:${canonical.id}:${members.length}`)
        .digest("hex")
        .slice(0, 12);

      clusters.push({
        id: clusterId,
        canonical,
        members,
        score: computeScore(members, now),
        projects,
      });
    }
  }

  clusters.sort((a, b) => b.score - a.score);
  return clusters;
}
