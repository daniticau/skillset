import pc from "picocolors";
import { readState } from "../core/config.js";
import { listStoreSkills, storeSkillDir } from "../core/store.js";
import { readSkillMd } from "../core/skill.js";
import type { SkillOrigin, SkillTier } from "../core/skill.js";

/**
 * Skills are grouped by the KIND of knowledge they carry, not by topic.
 *
 * Topic buckets ("iOS", "Browser") answer "what is this about?", which the
 * description already says. The useful question is "what kind of thing is
 * this?" — because that is how you reach for one: I need to drive a tool, I
 * need to follow a procedure, I need to make a call, or I need to respect a
 * constraint.
 */
const CATEGORIES = [
  "Tool",
  "Workflow",
  "Judgement",
  "Rule",
] as const;

type CatalogCategory = (typeof CATEGORIES)[number];

interface CatalogEntry {
  name: string;
  description: string;
  tier?: SkillTier;
  origin: SkillOrigin;
  userEdited: boolean;
  category: CatalogCategory;
}

/**
 * Word-boundary keyword match.
 *
 * Plain substring matching silently misfires: "whenever" contains "never", so
 * every skill whose description said "use whenever…" was classified as a hard
 * rule. Anchor each term to word boundaries instead.
 */
function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(text);
  });
}

export function categorizeSkill(skill: {
  name: string;
  description: string;
}): CatalogCategory {
  const text = `${skill.name} ${skill.description}`.toLowerCase();

  // Ordered most-specific first. A skill can mention a tool while really being
  // a constraint ("requires running verification commands"), so constraints and
  // judgement calls are tested before tool mentions.
  const isRule = hasAny(text, [
    "never",
    "always",
    "before claiming",
    "before committing",
    "before clicking",
    "irreversible",
    "requires running",
    "evidence before",
    "do not",
    "must not",
  ]);
  if (isRule) return "Rule";

  const isJudgement = hasAny(text, [
    "evaluat",
    "ranking",
    "choosing",
    "critiqu",
    "assess",
    "novelty",
    "aesthetic",
    "taste",
    "targeted questions",
    "ambiguous",
    "frontier",
    "subjective",
    "polish",
  ]);
  if (isJudgement) return "Judgement";

  const isTool = hasAny(text, [
    "cli",
    "command-line",
    "pnpm",
    "npm",
    "browser",
    "simulator",
    "tunnel",
    "webhook",
    "sdk",
    "terminal",
  ]);
  if (isTool) return "Tool";

  return "Workflow";
}

function originLabel(origin: SkillOrigin, userEdited: boolean): string {
  if (userEdited) return "user-edited";
  return origin === "user-created" ? "user-authored" : "auto-created";
}

function tierLabel(tier: SkillTier | undefined): string {
  return tier ? `tier ${tier}` : "legacy tier";
}

function wrap(text: string, width: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    if (!line) {
      line = word;
      continue;
    }
    if (line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line += ` ${word}`;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

async function loadCatalogEntries(): Promise<CatalogEntry[]> {
  const names = await listStoreSkills();
  const state = await readState();
  const entries: CatalogEntry[] = [];

  for (const name of names) {
    const parsed = await readSkillMd(storeSkillDir(name));
    const skillState = state.skills[parsed.frontmatter.name];
    const origin = parsed.frontmatter.origin ?? skillState?.origin ?? "user-created";
    const userEdited = skillState?.userEdited ?? false;
    entries.push({
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description,
      tier: parsed.frontmatter.tier,
      origin,
      userEdited,
      category: categorizeSkill(parsed.frontmatter),
    });
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

export async function catalogCommand(): Promise<void> {
  const entries = await loadCatalogEntries();
  if (entries.length === 0) {
    console.log(pc.dim("no skills in canonical store"));
    return;
  }

  const autoCreated = entries.filter((e) => e.origin === "auto-created").length;
  const userAuthored = entries.length - autoCreated;
  const edited = entries.filter((e) => e.userEdited).length;
  console.log(pc.bold(`Skill Catalog (${entries.length} skills)`));
  console.log(
    pc.dim(
      `${userAuthored} user-authored, ${autoCreated} auto-created${
        edited > 0 ? `, ${edited} user-edited` : ""
      }`
    )
  );

  const width = Math.max(60, Math.min(process.stdout.columns ?? 100, 120));
  const descriptionWidth = Math.max(42, width - 8);

  for (const category of CATEGORIES) {
    const group = entries.filter((entry) => entry.category === category);
    if (group.length === 0) continue;

    console.log();
    console.log(pc.bold(`${category} (${group.length})`));
    for (const entry of group) {
      const meta = [
        originLabel(entry.origin, entry.userEdited),
        tierLabel(entry.tier),
      ].join(" | ");
      console.log(`  ${pc.bold(entry.name)} ${pc.dim(`[${meta}]`)}`);
      for (const line of wrap(entry.description, descriptionWidth)) {
        console.log(`    ${pc.dim(line)}`);
      }
    }
  }
}
