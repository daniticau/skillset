import type { NuggetCategory, NuggetCluster } from "./types.js";

const CREATE_CATEGORIES = new Set<NuggetCategory>([
  "correction",
  "preference",
  "workflow",
  "style",
  "anti-pattern",
]);

const DURABLE_CUE_RE =
  /\b(?:always|never|prefer|from now on|going forward|remember|before|after|first|typically|usually|normally|avoid|do not|don't)\b/i;

export interface ClusterQualityStats {
  category: NuggetCategory;
  score: number;
  confidence: number;
  evidenceCount: number;
  effectiveOccurrences: number;
  projectCount: number;
  repeated: boolean;
  crossProject: boolean;
  llmBacked: boolean;
  hasContext: boolean;
  hasDurableCue: boolean;
  manualCapture: boolean;
}

export interface ClusterCreateAssessment {
  allowCreate: boolean;
  reason?: string;
  stats: ClusterQualityStats;
}

function avgConfidence(cluster: NuggetCluster): number {
  if (cluster.members.length === 0) return cluster.canonical.confidence;
  return cluster.members.reduce((sum, nugget) => sum + nugget.confidence, 0) / cluster.members.length;
}

function evidenceCount(cluster: NuggetCluster): number {
  return cluster.members.reduce((sum, nugget) => sum + nugget.evidence.length, 0);
}

function effectiveOccurrences(cluster: NuggetCluster): number {
  return cluster.members.reduce(
    (sum, nugget) => sum + Math.max(1, nugget.occurrences ?? nugget.evidence.length),
    0
  );
}

function projectCount(cluster: NuggetCluster): number {
  const projects = new Set(
    cluster.members.flatMap((nugget) => nugget.evidence.map((ev) => ev.project)).filter(Boolean)
  );
  return Math.max(projects.size, cluster.projects.filter(Boolean).length);
}

function isManualCapture(cluster: NuggetCluster): boolean {
  return cluster.members.some((nugget) =>
    nugget.evidence.some((ev) => ev.sessionId === "manual-skill-request" || ev.project === "manual")
  );
}

export function clusterQualityStats(cluster: NuggetCluster): ClusterQualityStats {
  const confidence = avgConfidence(cluster);
  const count = evidenceCount(cluster);
  const occurrences = effectiveOccurrences(cluster);
  const projects = projectCount(cluster);
  const crossProject =
    projects > 1 || cluster.members.some((nugget) => nugget.crossProject === true);

  return {
    category: cluster.canonical.category,
    score: cluster.score,
    confidence,
    evidenceCount: count,
    effectiveOccurrences: occurrences,
    projectCount: projects,
    repeated: occurrences >= 2 || count >= 2,
    crossProject,
    llmBacked: cluster.members.some(
      (nugget) => nugget.source === "llm" || nugget.validatedByLLM === true
    ),
    hasContext: cluster.members.some((nugget) => nugget.evidence.some((ev) => !!ev.context)),
    hasDurableCue: DURABLE_CUE_RE.test(cluster.canonical.signal),
    manualCapture: isManualCapture(cluster),
  };
}

export function describeClusterQuality(cluster: NuggetCluster): string {
  const stats = clusterQualityStats(cluster);
  const flags = [
    stats.manualCapture ? "manual" : undefined,
    stats.repeated ? "repeated" : "single",
    stats.crossProject ? "cross-project" : "single-project",
    stats.llmBacked ? "LLM-backed" : "heuristic",
    stats.hasDurableCue ? "durable-cue" : undefined,
    stats.hasContext ? "has-context" : undefined,
  ].filter(Boolean);

  return [
    `score=${stats.score.toFixed(2)}`,
    `confidence=${stats.confidence.toFixed(2)}`,
    `evidence=${stats.evidenceCount}`,
    `occurrences=${stats.effectiveOccurrences}`,
    `projects=${stats.projectCount}`,
    `flags=${flags.join(",")}`,
  ].join("; ");
}

export function assessClusterForCreate(cluster: NuggetCluster): ClusterCreateAssessment {
  const stats = clusterQualityStats(cluster);

  if (stats.manualCapture) {
    return { allowCreate: true, stats, reason: "manual capture" };
  }

  if (!CREATE_CATEGORIES.has(stats.category)) {
    return {
      allowCreate: false,
      stats,
      reason: `category "${stats.category}" is not specific enough for a new skill`,
    };
  }

  if (stats.score < 0.5) {
    return {
      allowCreate: false,
      stats,
      reason: `cluster score ${stats.score.toFixed(2)} is below the create threshold`,
    };
  }

  if (stats.repeated || stats.crossProject) {
    return { allowCreate: true, stats };
  }

  const strongSingleton = stats.confidence >= 0.85 && stats.hasDurableCue;
  const contextualCorrection =
    stats.category === "correction" && stats.hasContext && stats.confidence >= 0.65;

  if (strongSingleton || contextualCorrection) {
    return { allowCreate: true, stats };
  }

  return {
    allowCreate: false,
    stats,
    reason:
      "needs repeated evidence, cross-project evidence, manual capture, or a high-confidence durable cue",
  };
}
