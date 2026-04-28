/**
 * Skill generation helpers — turn mined clusters into EDIT/CREATE/SKIP actions.
 *
 * For each cluster: ask the LLM to triage against existing skills, then execute
 * the chosen action. EDITs and CREATEs both write the canonical store directly;
 * SKIPs are recorded by callers so the cluster isn't reconsidered too often.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { NuggetCluster } from "./types.js";
import type { LLMConfig } from "./llm/index.js";
import {
  chat,
  parseLLMJson,
  synthesisSystemPrompt,
  synthesisUserPrompt,
  triageSystemPrompt,
  triageUserPrompt,
  editRewriteSystemPrompt,
  editRewriteUserPrompt,
} from "./llm/index.js";
import { storeSkillDir, listStoreSkills } from "../core/store.js";
import {
  readSkillMd,
  parseSkillMd,
  isSkillTier,
  renderSkillMd,
} from "../core/skill.js";
import type { SkillTier } from "../core/skill.js";
import type { SkillOrigin } from "../core/skill.js";
import { writeCanonicalSkill, DRAFTS_DIR } from "./synthesize.js";
import type { SynthesizedSkill } from "./synthesize.js";

export interface SkillSummary {
  name: string;
  description: string;
}

export type SkillAction =
  | { kind: "edit"; targetName: string; tier: SkillTier; rationale?: string }
  | {
      kind: "create";
      name: string;
      description: string;
      tier: SkillTier;
      rationale?: string;
    }
  | { kind: "skip"; reason?: string };

export async function loadExistingSkillSummaries(): Promise<SkillSummary[]> {
  const names = await listStoreSkills();
  const out: SkillSummary[] = [];
  for (const name of names) {
    try {
      const parsed = await readSkillMd(storeSkillDir(name));
      out.push({
        name: parsed.frontmatter.name,
        description: parsed.frontmatter.description,
      });
    } catch {
      // skip malformed canonical skills
    }
  }
  return out;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

/**
 * Coerce raw LLM output into a valid SkillAction and apply budget/existence
 * corrections:
 *  - EDIT with a non-existent target → CREATE (if budget) or SKIP
 *  - CREATE with a name that already exists → EDIT on that name
 *  - CREATE when budget is 0 → SKIP
 */
function coerceTier(raw: unknown): SkillTier {
  return isSkillTier(raw) ? raw : "low";
}

function normalizeAction(
  raw: unknown,
  summaries: SkillSummary[],
  budgetRemaining: number
): SkillAction {
  const obj = raw as { kind?: string; tier?: unknown } | null;
  const kind = obj?.kind;
  const existing = new Set(summaries.map((s) => s.name));
  const tier = coerceTier(obj?.tier);

  if (kind === "skip") {
    const reason = (obj as { reason?: unknown }).reason;
    return {
      kind: "skip",
      reason: typeof reason === "string" ? reason : undefined,
    };
  }

  if (kind === "edit") {
    const r = obj as { targetName?: unknown; rationale?: unknown };
    const target = typeof r.targetName === "string" ? r.targetName : "";
    const rationale = typeof r.rationale === "string" ? r.rationale : undefined;
    if (!target) {
      return { kind: "skip", reason: "triage EDIT missing targetName" };
    }
    if (!existing.has(target)) {
      if (budgetRemaining <= 0) {
        return {
          kind: "skip",
          reason: `triage EDIT target "${target}" doesn't exist and budget is 0`,
        };
      }
      const slug = slugify(target) || "new-skill";
      return {
        kind: "create",
        name: slug,
        description: rationale ?? `Derived from EDIT of missing skill "${target}"`,
        tier,
        rationale: rationale ?? "coerced from EDIT on missing target",
      };
    }
    return { kind: "edit", targetName: target, tier, rationale };
  }

  if (kind === "create") {
    const r = obj as { name?: unknown; description?: unknown; rationale?: unknown };
    if (budgetRemaining <= 0) {
      return { kind: "skip", reason: "budget exceeded" };
    }
    const slug = slugify(typeof r.name === "string" ? r.name : "");
    if (!slug) return { kind: "skip", reason: "triage CREATE produced empty name" };
    if (existing.has(slug)) {
      const rationale = typeof r.rationale === "string" ? r.rationale : undefined;
      return {
        kind: "edit",
        targetName: slug,
        tier,
        rationale: rationale ?? `CREATE name "${slug}" collided with existing skill`,
      };
    }
    const description =
      typeof r.description === "string" && r.description.length > 0
        ? r.description
        : "Personalization skill synthesized from observed behavior";
    const rationale = typeof r.rationale === "string" ? r.rationale : undefined;
    return { kind: "create", name: slug, description, tier, rationale };
  }

  return { kind: "skip", reason: `triage returned unknown kind: ${String(kind)}` };
}

export async function planSkillAction(
  cluster: NuggetCluster,
  summaries: SkillSummary[],
  config: LLMConfig,
  budgetRemaining: number
): Promise<SkillAction> {
  const result = await chat(config, {
    messages: [
      { role: "system", content: triageSystemPrompt(summaries) },
      { role: "user", content: triageUserPrompt(cluster, budgetRemaining) },
    ],
    temperature: 0.2,
    maxTokens: 500,
  });

  const parsed = parseLLMJson<unknown>(result.content);
  if (!parsed) {
    return { kind: "skip", reason: "triage failed: could not parse LLM response" };
  }
  return normalizeAction(parsed, summaries, budgetRemaining);
}

function tierRank(t: SkillTier | undefined): number {
  if (t === "high") return 2;
  if (t === "medium") return 1;
  if (t === "low") return 0;
  return -1;
}

/**
 * Rewrite the target canonical skill to incorporate a new cluster's evidence.
 * Writes back to ~/.skillset/skills/<name>/SKILL.md directly. Tier and origin are
 * preserved (tier may upgrade, never downgrade) regardless of what the LLM emits.
 *
 * Caller is responsible for refusing to call executeEdit on origin=user-created
 * skills — this function trusts the triage layer to filter.
 */
export async function executeEdit(
  targetName: string,
  cluster: NuggetCluster,
  config: LLMConfig
): Promise<{ path: string }> {
  const dir = storeSkillDir(targetName);
  const skillPath = join(dir, "SKILL.md");
  const current = await readFile(skillPath, "utf8");
  const currentParsed = parseSkillMd(current);
  const existingTier = currentParsed.frontmatter.tier;
  const existingOrigin = currentParsed.frontmatter.origin;
  const existingLicense = currentParsed.frontmatter.license;

  const result = await chat(config, {
    messages: [
      { role: "system", content: editRewriteSystemPrompt() },
      { role: "user", content: editRewriteUserPrompt(current, cluster) },
    ],
    temperature: 0.2,
    maxTokens: 1800,
  });

  let raw = result.content.trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:\w+)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  // Validate — ensure the LLM kept a well-formed SKILL.md.
  const rewritten = parseSkillMd(raw);
  // Never let EDIT rename a skill.
  const finalName = targetName;
  // Never downgrade tier. If the LLM dropped the field on a tiered skill, restore it.
  let finalTier = rewritten.frontmatter.tier;
  if (existingTier && (finalTier === undefined || tierRank(finalTier) < tierRank(existingTier))) {
    finalTier = existingTier;
  }

  const body = renderSkillMd(
    {
      name: finalName,
      description: rewritten.frontmatter.description,
      tier: finalTier,
      license: rewritten.frontmatter.license ?? existingLicense,
      origin: existingOrigin,
    },
    rewritten.body
  );

  await writeFile(skillPath, body, "utf8");
  return { path: skillPath };
}

/** Generate a brand-new SKILL.md directly in the canonical store. */
export async function executeCreate(
  action: Extract<SkillAction, { kind: "create" }>,
  cluster: NuggetCluster,
  config: LLMConfig,
  options: { origin?: SkillOrigin } = {}
): Promise<{ path: string; skill: SynthesizedSkill }> {
  const result = await chat(config, {
    messages: [
      { role: "system", content: synthesisSystemPrompt() },
      { role: "user", content: synthesisUserPrompt(cluster) },
    ],
    temperature: 0.2,
    maxTokens: 1400,
  });

  let raw = result.content.trim();
  if (raw.startsWith("```")) {
    raw = raw.replace(/^```(?:\w+)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  // Try to parse as a full SKILL.md; fall back to treating the whole thing as body.
  let description = action.description;
  let body = raw;
  let parsedTier: SkillTier | undefined;
  try {
    const parsed = parseSkillMd(raw);
    body = parsed.body.trim();
    if (parsed.frontmatter.description && parsed.frontmatter.description.length > 0) {
      description = parsed.frontmatter.description;
    }
    parsedTier = parsed.frontmatter.tier;
  } catch {
    // keep raw body + action-supplied description
  }

  // Triage tier wins over whatever the synthesis prompt emitted — triage saw
  // the cluster + existing skills and is the source of truth for tier policy.
  const tier = action.tier ?? parsedTier ?? "low";

  const skill: SynthesizedSkill = {
    name: action.name,
    description,
    body,
    tier,
    origin: options.origin,
    sourceClusterIds: [cluster.id],
    score: cluster.score,
    memberCount: cluster.members.length,
  };
  const path = await writeCanonicalSkill(skill);
  return { path, skill };
}

export { DRAFTS_DIR };
