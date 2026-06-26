import pc from "picocolors";
import { readState } from "../core/config.js";
import { listStoreSkills, storeSkillDir } from "../core/store.js";
import { readSkillMd } from "../core/skill.js";
import type { SkillOrigin, SkillTier } from "../core/skill.js";
import { readUsageEvents, summarizeUsage } from "../usage/events.js";

const CATEGORIES = [
  "Skill Capture & Memory",
  "iOS & App Store",
  "Browser & Desktop Automation",
  "Visual, Media & Assets",
  "Writing & Applications",
  "Release Safety",
  "Collaboration & Clarification",
  "Other",
] as const;

type CatalogCategory = (typeof CATEGORIES)[number];

interface CatalogEntry {
  name: string;
  description: string;
  tier?: SkillTier;
  origin: SkillOrigin;
  userEdited: boolean;
  usageCount: number;
  lastUsedAt?: string;
  category: CatalogCategory;
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

export function categorizeSkill(skill: {
  name: string;
  description: string;
}): CatalogCategory {
  const text = `${skill.name} ${skill.description}`.toLowerCase();

  if (
    hasAny(text, [
      "skillset",
      "skillify",
      "skill this",
      "remember",
      "capture",
      "reusable skill",
      "reusable agent preference",
    ])
  ) {
    return "Skill Capture & Memory";
  }
  if (
    hasAny(text, [
      "ios",
      "app store",
      "swiftui",
      "uitabbar",
      "liquid glass",
      "tab bar",
      "navigation rail",
      "native glass",
    ])
  ) {
    return "iOS & App Store";
  }
  if (
    hasAny(text, [
      "browser",
      "browser use",
      "chrome",
      "computer use",
      "helium",
      "desktop",
      "window",
    ])
  ) {
    return "Browser & Desktop Automation";
  }
  if (
    hasAny(text, [
      "visual",
      "aesthetic",
      "screenshot",
      "screen recording",
      "video",
      "spritesheet",
      "animation",
      "design",
      "layout polish",
      "pet asset",
    ])
  ) {
    return "Visual, Media & Assets";
  }
  if (
    hasAny(text, [
      "resume",
      "job description",
      "internship",
      "fellowship",
      "application",
      "cover letter",
    ])
  ) {
    return "Writing & Applications";
  }
  if (
    hasAny(text, [
      "irreversible",
      "release",
      "deployment",
      "deploy",
      "publishing",
      "publish",
      "rollout",
      "confirmation",
    ])
  ) {
    return "Release Safety";
  }
  if (
    hasAny(text, [
      "clarify",
      "clarifying",
      "intended",
      "ambiguous",
      "terse",
      "frustrated",
      "shorthand",
    ])
  ) {
    return "Collaboration & Clarification";
  }
  return "Other";
}

function originLabel(origin: SkillOrigin, userEdited: boolean): string {
  if (userEdited) return "user-edited";
  return origin === "user-created" ? "user-authored" : "auto-created";
}

function tierLabel(tier: SkillTier | undefined): string {
  return tier ? `tier ${tier}` : "legacy tier";
}

function usageLabel(count: number, lastUsedAt: string | undefined): string {
  const uses = `${count} ${count === 1 ? "use" : "uses"}`;
  return lastUsedAt ? `${uses}, last ${lastUsedAt.slice(0, 10)}` : uses;
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
  const usage = summarizeUsage(await readUsageEvents());
  const entries: CatalogEntry[] = [];

  for (const name of names) {
    const parsed = await readSkillMd(storeSkillDir(name));
    const usageSummary = usage.get(parsed.frontmatter.name);
    const skillState = state.skills[parsed.frontmatter.name];
    const origin = parsed.frontmatter.origin ?? skillState?.origin ?? "user-created";
    const userEdited = skillState?.userEdited ?? false;
    entries.push({
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description,
      tier: parsed.frontmatter.tier,
      origin,
      userEdited,
      usageCount: usageSummary?.count ?? 0,
      lastUsedAt: usageSummary?.lastUsedAt,
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
        usageLabel(entry.usageCount, entry.lastUsedAt),
      ].join(" | ");
      console.log(`  ${pc.bold(entry.name)} ${pc.dim(`[${meta}]`)}`);
      for (const line of wrap(entry.description, descriptionWidth)) {
        console.log(`    ${pc.dim(line)}`);
      }
    }
  }
}
