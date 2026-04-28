import { createHash } from "node:crypto";
import type { NuggetCategory, NuggetCluster } from "./types.js";

function stableId(prefix: string, input: string): string {
  const hash = createHash("sha256").update(input).digest("hex").slice(0, 16);
  return `${prefix}-${hash}`;
}

export function inferDirectSkillCategory(input: string): NuggetCategory {
  if (/\b(?:never|don't|do not|avoid|stop)\b/i.test(input)) return "anti-pattern";
  if (/\b(?:before|after|first|then|workflow|process)\b/i.test(input)) return "workflow";
  if (/\b(?:style|format|naming|indent|spaces|tabs|tone)\b/i.test(input)) return "style";
  if (/\b(?:tool|command|cli|use .+ instead of)\b/i.test(input)) return "tool-pattern";
  return "preference";
}

export function createDirectSkillCluster(input: string): NuggetCluster {
  const text = input.trim();
  const id = stableId("direct", text);
  const now = new Date().toISOString();
  const category = inferDirectSkillCategory(text);
  const nugget = {
    id: `${id}-nugget`,
    category,
    signal: text,
    evidence: [
      {
        sessionId: "manual-skill-request",
        project: "manual",
        userMessage: text,
        timestamp: now,
      },
    ],
    project: "manual",
    confidence: 1,
    source: "llm" as const,
    createdAt: now,
    validatedByLLM: true,
    crossProject: true,
    occurrences: 1,
  };

  return {
    id,
    canonical: nugget,
    members: [nugget],
    score: 1,
    projects: ["manual"],
  };
}
