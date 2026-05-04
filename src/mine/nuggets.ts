import type { Nugget } from "./types.js";

export function mergeNuggets(existing: Nugget[], incoming: Nugget[]): Nugget[] {
  const map = new Map<string, Nugget>();
  for (const n of existing) map.set(n.id, n);
  for (const n of incoming) {
    const prev = map.get(n.id);
    if (!prev) {
      map.set(n.id, n);
      continue;
    }
    const mergedEvidence = [...prev.evidence];
    for (const ev of n.evidence) {
      if (
        !mergedEvidence.some(
          (e) => e.sessionId === ev.sessionId && e.userMessage === ev.userMessage
        )
      ) {
        mergedEvidence.push(ev);
      }
    }
    map.set(n.id, {
      ...prev,
      ...n,
      evidence: mergedEvidence.slice(0, 5),
      confidence: Math.max(prev.confidence, n.confidence),
      validatedByLLM: prev.validatedByLLM || n.validatedByLLM,
    });
  }
  return [...map.values()];
}
