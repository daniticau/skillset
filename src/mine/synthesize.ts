/**
 * Skill synthesis — turn ranked nugget clusters into draft SKILL.md files.
 *
 * Output goes to ~/.skillset/drafts/<name>/SKILL.md. Drafts are reviewed
 * by the user and promoted to the canonical store via `skillset promote`.
 */

import { join } from "node:path";
import { mkdir, writeFile, readdir, readFile, rm, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import matter from "gray-matter";
import type { NuggetCluster } from "./types.js";
import {
  chat,
  synthesisSystemPrompt,
  synthesisUserPrompt,
} from "./llm/index.js";
import type { LLMConfig } from "./llm/index.js";
import {
  parseSkillMd,
  renderSkillMd,
  SkillValidationError,
} from "../core/skill.js";
import type { SkillOrigin, SkillTier } from "../core/skill.js";
import { STORE_ROOT, STORE_SKILLS_DIR } from "../core/paths.js";

export const DRAFTS_DIR = join(STORE_ROOT, "drafts");

export interface SynthesizedSkill {
  name: string;
  description: string;
  body: string;
  tier?: SkillTier;
  origin?: SkillOrigin;
  provenance?: Record<string, unknown>;
  sourceClusterIds: string[];
  score: number;
  memberCount: number;
}

export interface SynthesizeOptions {
  maxSkills?: number;
  minClusterMembers?: number;
  temperature?: number;
  onProgress?: (done: number, total: number) => void;
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

/** Extract frontmatter + body from an LLM response, tolerating common wrappers. */
function parseSynthesizedContent(raw: string): { name: string; description: string; body: string } | null {
  let clean = raw.trim();
  if (clean.startsWith("```")) {
    clean = clean.replace(/^```(?:\w+)?\s*\n/, "").replace(/\n```\s*$/, "");
  }
  if (!clean.startsWith("---")) {
    // Sometimes the model outputs "---\n" wrapped in extra prose
    const fm = clean.indexOf("---");
    if (fm === -1) return null;
    clean = clean.slice(fm);
  }

  try {
    const parsed = parseSkillMd(clean);
    return {
      name: slugify(parsed.frontmatter.name) || "unnamed-skill",
      description: parsed.frontmatter.description,
      body: parsed.body.trim(),
    };
  } catch (err) {
    if (err instanceof SkillValidationError) {
      // Try to extract manually
      const { data, content } = matter(clean);
      const name =
        typeof data.name === "string" && data.name ? slugify(data.name) : null;
      const description =
        typeof data.description === "string" ? data.description : null;
      if (name && description) {
        return { name, description, body: content.trim() };
      }
    }
    return null;
  }
}

/** Synthesize one cluster into a SkillMD. */
async function synthesizeOne(
  cluster: NuggetCluster,
  config: LLMConfig,
  temperature: number
): Promise<SynthesizedSkill | null> {
  const result = await chat(config, {
    messages: [
      { role: "system", content: synthesisSystemPrompt() },
      { role: "user", content: synthesisUserPrompt(cluster) },
    ],
    temperature,
    maxTokens: 1200,
  });

  const parsed = parseSynthesizedContent(result.content);
  if (!parsed) return null;

  return {
    name: parsed.name,
    description: parsed.description,
    body: parsed.body,
    sourceClusterIds: [cluster.id],
    score: cluster.score,
    memberCount: cluster.members.length,
  };
}

async function writeSkillFiles(root: string, skill: SynthesizedSkill): Promise<string> {
  const dir = join(root, skill.name);
  await mkdir(dir, { recursive: true });

  const filePath = join(dir, "SKILL.md");
  await writeFile(
    filePath,
    renderSkillMd(
      {
        name: skill.name,
        description: skill.description,
        tier: skill.tier,
        origin: skill.origin ?? "auto-created",
      },
      skill.body
    ),
    "utf8"
  );

  const metaPath = join(dir, "meta.json");
  await writeFile(
    metaPath,
    JSON.stringify(
      {
        sourceClusterIds: skill.sourceClusterIds,
        score: skill.score,
        memberCount: skill.memberCount,
        createdAt: new Date().toISOString(),
        ...(skill.provenance ?? {}),
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  return filePath;
}

/** Synthesize multiple clusters into draft skills. */
export async function synthesizeSkills(
  clusters: NuggetCluster[],
  config: LLMConfig,
  options: SynthesizeOptions = {}
): Promise<SynthesizedSkill[]> {
  const maxSkills = options.maxSkills ?? 10;
  const minMembers = options.minClusterMembers ?? 2;
  const temperature = options.temperature ?? 0.2;

  // Filter clusters and take top N
  const eligible = clusters
    .filter((c) => c.members.length >= minMembers)
    .slice(0, maxSkills);

  const skills: SynthesizedSkill[] = [];
  for (let i = 0; i < eligible.length; i++) {
    const cluster = eligible[i]!;
    try {
      const skill = await synthesizeOne(cluster, config, temperature);
      if (skill) skills.push(skill);
    } catch {
      // Swallow per-cluster errors; one bad synthesis doesn't kill the run
    }
    options.onProgress?.(i + 1, eligible.length);
  }

  // Deduplicate by slug — if two clusters produced the same name, keep the higher-score one
  const byName = new Map<string, SynthesizedSkill>();
  for (const s of skills) {
    const existing = byName.get(s.name);
    if (!existing || s.score > existing.score) byName.set(s.name, s);
  }
  return [...byName.values()];
}

/** Write a synthesized skill directly to the canonical store. */
export async function writeCanonicalSkill(skill: SynthesizedSkill): Promise<string> {
  return writeSkillFiles(STORE_SKILLS_DIR, skill);
}

/** Write a synthesized skill to the drafts directory. */
export async function writeDraftSkill(skill: SynthesizedSkill): Promise<string> {
  return writeSkillFiles(DRAFTS_DIR, skill);
}

/** List all draft skills. */
export async function listDrafts(): Promise<
  Array<{ name: string; description: string; path: string }>
> {
  if (!existsSync(DRAFTS_DIR)) return [];

  const entries = await readdir(DRAFTS_DIR, { withFileTypes: true });
  const drafts: Array<{ name: string; description: string; path: string }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = join(DRAFTS_DIR, entry.name, "SKILL.md");
    if (!existsSync(skillPath)) continue;
    try {
      const raw = await readFile(skillPath, "utf8");
      const parsed = parseSkillMd(raw);
      drafts.push({
        name: parsed.frontmatter.name,
        description: parsed.frontmatter.description,
        path: skillPath,
      });
    } catch {
      // skip malformed drafts
    }
  }

  return drafts;
}

/**
 * Promote a draft to the canonical store.
 * Moves the draft directory from ~/.skillset/drafts/<name>/ to ~/.skillset/skills/<name>/.
 */
export async function promoteDraft(name: string): Promise<string> {
  const src = join(DRAFTS_DIR, name);
  const dst = join(STORE_SKILLS_DIR, name);

  if (!existsSync(src)) {
    throw new Error(`No draft named "${name}" at ${src}`);
  }
  if (existsSync(dst)) {
    throw new Error(`Skill "${name}" already exists in the canonical store`);
  }

  await mkdir(STORE_SKILLS_DIR, { recursive: true });
  await cp(src, dst, { recursive: true });
  await rm(src, { recursive: true, force: true });

  return dst;
}
