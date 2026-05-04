import type { NuggetCategory, NuggetCluster, NuggetFocus } from "./types.js";

export const PRIMARY_FOCUSES: readonly NuggetFocus[] = [
  "agent-mistake",
  "user-preference",
];

export function focusForCategory(category: NuggetCategory): NuggetFocus {
  switch (category) {
    case "correction":
    case "rejection":
    case "anti-pattern":
      return "agent-mistake";
    case "preference":
    case "style":
    case "workflow":
      return "user-preference";
    case "tool-pattern":
    case "topic":
      return "other";
  }
}

export function focusForCluster(cluster: NuggetCluster): NuggetFocus {
  return cluster.focus ?? focusForCategory(cluster.canonical.category);
}

export function isPrimaryFocus(focus: NuggetFocus): boolean {
  return focus === "agent-mistake" || focus === "user-preference";
}

export function focusCounts(
  clusters: NuggetCluster[]
): Record<"agent-mistake" | "user-preference" | "other", number> {
  return clusters.reduce(
    (acc, cluster) => {
      acc[focusForCluster(cluster)] += 1;
      return acc;
    },
    { "agent-mistake": 0, "user-preference": 0, other: 0 }
  );
}

/**
 * Order clusters for creation attempts. When both primary lanes have candidates
 * and the caller has enough create budget, put one from each lane first, then
 * continue by score. This reserves attention, not guaranteed creates: LLM
 * triage may still edit or skip.
 */
export function balancedClusterOrder(
  clusters: NuggetCluster[],
  createBudget: number
): NuggetCluster[] {
  const primary = clusters
    .filter((cluster) => isPrimaryFocus(focusForCluster(cluster)))
    .sort((a, b) => b.score - a.score);

  if (createBudget < 2) return primary;

  const topMistake = primary.find((cluster) => focusForCluster(cluster) === "agent-mistake");
  const topPreference = primary.find((cluster) => focusForCluster(cluster) === "user-preference");
  if (!topMistake || !topPreference) return primary;

  const front = [topMistake, topPreference].sort((a, b) => b.score - a.score);
  const frontIds = new Set(front.map((cluster) => cluster.id));
  return [...front, ...primary.filter((cluster) => !frontIds.has(cluster.id))];
}

export function cappedFocusCandidates(
  clusters: NuggetCluster[],
  caps: { mistakeCap: number; preferenceCap: number; fillCap: number }
): NuggetCluster[] {
  const primary = clusters
    .filter((cluster) => isPrimaryFocus(focusForCluster(cluster)))
    .sort((a, b) => b.score - a.score);
  const picked: NuggetCluster[] = [
    ...primary
      .filter((cluster) => focusForCluster(cluster) === "agent-mistake")
      .slice(0, Math.max(0, caps.mistakeCap)),
    ...primary
      .filter((cluster) => focusForCluster(cluster) === "user-preference")
      .slice(0, Math.max(0, caps.preferenceCap)),
  ];
  const pickedIds = new Set(picked.map((cluster) => cluster.id));
  const fill = primary
    .filter((cluster) => !pickedIds.has(cluster.id))
    .slice(0, Math.max(0, caps.fillCap));
  return [...picked, ...fill].sort((a, b) => b.score - a.score);
}
