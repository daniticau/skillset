/**
 * Decomposition-first skill authoring.
 *
 * A raw idea ("agents should verify before claiming done") is rarely one skill.
 * It usually contains a rule, the evidence formats that make the rule
 * actionable, and sometimes an unrelated aside. Installing that as one blob
 * produces a skill that triggers vaguely and says too much.
 *
 * This module asks the model to find the *smallest reusable units* in the idea
 * and emit one tight skill per unit, cross-linked with [[name]] references. The
 * unit boundary is the thing being optimized for: small units compose, and an
 * agent can pull in exactly the one it needs.
 */

import { chat, defaultLLMConfig, parseLLMJson } from "../llm/index.js";
import type { LLMConfig } from "../llm/index.js";

/** Same four kinds the library groups by, so one vocabulary spans the app. */
export type SkillUnitKind = "rule" | "workflow" | "tool" | "judgement";

export interface ProposedSkill {
  name: string;
  description: string;
  body: string;
  /** What kind of atomic unit this is — drives tier and review expectations. */
  kind: SkillUnitKind;
  /** Plain-language trigger: when an agent should reach for this. */
  trigger: string;
  /** What goes wrong without it. Empty means the skill has no justification. */
  prevents: string;
  /** Names of sibling skills this one references. */
  links: string[];
  tier: "high" | "medium" | "low";
}

export interface DecomposeResult {
  skills: ProposedSkill[];
  /** One-line explanation of why the idea split the way it did. */
  rationale: string;
}

const SYSTEM = `You decompose a user's raw instruction into the smallest reusable agent skills.

A skill is a unit of knowledge an agent CANNOT derive on its own: a personal preference, a private tool, a hard-won workflow, a judgement algorithm the user invented. General knowledge the model already has is NOT a skill — never emit one for it.

Find the smallest units. If the idea contains one rule, emit one skill. If it contains a rule plus the reference material that makes the rule actionable, emit two and link them. Never emit more than 4. Prefer fewer, sharper skills over many thin ones.

Rules for each skill:
- name: kebab-case, 2-4 words, specific. Never generic like "helper" or "guidelines".
- description: ONE sentence starting with "Use when" or "Apply when" or "Apply before", naming concrete trigger conditions an agent can match against. This is the only thing an agent sees when deciding to load the skill, so it must be discoverable. Under 300 characters.
- body: markdown. Lead with the rule itself. Be specific and imperative. No preamble, no restating the description. Under 400 words. Use [[other-skill-name]] to reference a sibling skill.
- kind: exactly one of "rule" (a durable constraint the agent must respect), "workflow" (ordered steps for a task), "tool" (how to drive a specific piece of software or CLI), or "judgement" (an algorithm for deciding or evaluating something).
- trigger: plain language, when an agent should reach for this.
- prevents: what concretely goes wrong without it.
- tier: "high" for a narrow single-fact preference, "medium" for workflow/tool-routing, "low" for broad behavior change.

Return ONLY JSON:
{"rationale":"...","skills":[{"name":"...","description":"...","body":"...","kind":"rule","trigger":"...","prevents":"...","links":["..."],"tier":"medium"}]}`;

function userPrompt(idea: string, existing: Array<{ name: string; description: string }>): string {
  const lines = [`Raw instruction from the user:`, ``, idea.trim(), ``];
  if (existing.length > 0) {
    lines.push(
      `Skills that already exist. If the instruction belongs in one of these, return an empty skills array and say so in the rationale — do not duplicate:`,
      ``,
      ...existing.map((s) => `- ${s.name}: ${s.description}`),
      ``
    );
  }
  lines.push(`Decompose into the smallest reusable units. Return only JSON.`);
  return lines.join("\n");
}

const VALID_KINDS: SkillUnitKind[] = ["rule", "workflow", "tool", "judgement"];
const VALID_TIERS = ["high", "medium", "low"] as const;

function coerceSkill(raw: unknown): ProposedSkill | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name.trim() : "";
  const description = typeof r.description === "string" ? r.description.trim() : "";
  const body = typeof r.body === "string" ? r.body.trim() : "";
  if (!name || !description || !body) return null;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return null;

  const kind = VALID_KINDS.includes(r.kind as SkillUnitKind)
    ? (r.kind as SkillUnitKind)
    : "rule";
  const tier = (VALID_TIERS as readonly string[]).includes(r.tier as string)
    ? (r.tier as ProposedSkill["tier"])
    : "medium";

  return {
    name,
    description,
    body,
    kind,
    tier,
    trigger: typeof r.trigger === "string" ? r.trigger.trim() : "",
    prevents: typeof r.prevents === "string" ? r.prevents.trim() : "",
    links: Array.isArray(r.links)
      ? r.links.filter((l): l is string => typeof l === "string")
      : [],
  };
}

export function parseDecomposeResponse(text: string): DecomposeResult {
  const parsed = parseLLMJson<{ rationale?: unknown; skills?: unknown }>(text);
  if (!parsed || typeof parsed !== "object") {
    return { skills: [], rationale: "model returned no usable JSON" };
  }
  const skills = Array.isArray(parsed.skills)
    ? parsed.skills.map(coerceSkill).filter((s): s is ProposedSkill => s !== null)
    : [];
  return {
    skills: skills.slice(0, 4),
    rationale:
      typeof parsed.rationale === "string" && parsed.rationale.trim()
        ? parsed.rationale.trim()
        : skills.length === 0
          ? "no reusable unit found in the instruction"
          : "",
  };
}

export async function decomposeIdea(
  idea: string,
  existing: Array<{ name: string; description: string }>,
  config?: LLMConfig
): Promise<DecomposeResult> {
  const cfg = config ?? defaultLLMConfig();
  const result = await chat(cfg, {
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userPrompt(idea, existing) },
    ],
    temperature: 0,
    jsonMode: true,
  });
  return parseDecomposeResponse(result.content);
}
