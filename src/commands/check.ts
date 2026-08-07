import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import pc from "picocolors";
import { STORE_SKILLS_DIR } from "../core/paths.js";
import { listSkillDirs, readSkillMd } from "../core/skill.js";
import { listStoreSkills, storeSkillDir } from "../core/store.js";

export type CheckSeverity = "error" | "warning";

export interface SkillCheckIssue {
  severity: CheckSeverity;
  skill: string;
  message: string;
}

export interface CheckResult {
  checked: number;
  valid: number;
  errors: number;
  warnings: number;
  issues: SkillCheckIssue[];
}

const TRIGGER_RE = /\b(?:use|apply) when\b|\bwhen (?:the user|working|building|creating|editing|running|testing|using)\b|\buser (?:asks?|says?|requests?)\b|\bbefore\b/i;

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/**
 * Content rules that depend only on a skill's text, not on what is on disk.
 *
 * Shared with `sks build` so a skill is authored against exactly the standard it
 * will later be checked against — there is no way to build something that
 * `check` would immediately flag.
 */
export function validateProposedSkill(
  name: string,
  description: string,
  body: string
): SkillCheckIssue[] {
  const issues: SkillCheckIssue[] = [];
  if (!body.trim()) {
    issues.push({ severity: "error", skill: name, message: "body is empty" });
  }
  if (!description.trim()) {
    issues.push({ severity: "error", skill: name, message: "description is empty" });
  }
  if (!TRIGGER_RE.test(description)) {
    issues.push({
      severity: "warning",
      skill: name,
      message: "description does not clearly say when the skill should trigger",
    });
  }
  if (description.length > 300) {
    issues.push({
      severity: "warning",
      skill: name,
      message: `description is ${description.length} characters; keep discovery metadata concise`,
    });
  }
  const words = wordCount(body);
  const lines = body.split("\n").length;
  if (words > 1000 || lines > 500) {
    issues.push({
      severity: "warning",
      skill: name,
      message: `body is large (${words} words, ${lines} lines); move optional detail into referenced files`,
    });
  }
  return issues;
}

async function inspectSkill(name: string): Promise<SkillCheckIssue[]> {
  const issues: SkillCheckIssue[] = [];
  try {
    const parsed = await readSkillMd(storeSkillDir(name));
    if (parsed.frontmatter.name !== name) {
      issues.push({
        severity: "error",
        skill: name,
        message: `folder name does not match frontmatter name "${parsed.frontmatter.name}"`,
      });
    }
    issues.push(
      ...validateProposedSkill(name, parsed.frontmatter.description, parsed.body)
    );
    // Require code/link-style delimiters so prose such as "icon assets/audit"
    // is not mistaken for a bundled path.
    const resourcePattern = /(?:^|[`'"(])((?:references|scripts|assets)\/[a-zA-Z0-9._/-]+)/g;
    const referenced = new Set<string>();
    for (const match of parsed.body.matchAll(resourcePattern)) {
      const path = match[1]?.replace(/[.,;:]+$/, "");
      if (path) referenced.add(path);
    }
    for (const resource of referenced) {
      if (!existsSync(join(storeSkillDir(name), resource))) {
        issues.push({
          severity: "error",
          skill: name,
          message: `referenced resource does not exist: ${resource}`,
        });
      }
    }
    for (const junk of [".git", "node_modules", "__pycache__", ".DS_Store"]) {
      if (existsSync(join(storeSkillDir(name), junk))) {
        issues.push({
          severity: "warning",
          skill: name,
          message: `skill contains ignored repository/cache artifact: ${junk}`,
        });
      }
    }
  } catch (err) {
    issues.push({
      severity: "error",
      skill: name,
      message: err instanceof Error ? err.message : String(err),
    });
  }
  return issues;
}

async function findSkillFiles(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await findSkillFiles(path)));
    } else if (entry.isFile() && entry.name === "SKILL.md") {
      found.push(path);
    }
  }
  return found;
}

async function unmanagedSkillIssues(): Promise<SkillCheckIssue[]> {
  const managed = new Set(await listSkillDirs(STORE_SKILLS_DIR));
  const all = await findSkillFiles(STORE_SKILLS_DIR);
  return all
    .filter((path) => !managed.has(path.slice(0, -"/SKILL.md".length)))
    .map((path) => ({
      severity: "warning" as const,
      skill: "store",
      message: `unmanaged nested skill file: ${relative(STORE_SKILLS_DIR, path)}`,
    }));
}

export async function inspectSkills(name?: string): Promise<CheckResult> {
  const names = name ? [name] : await listStoreSkills();
  const issues: SkillCheckIssue[] = [];
  for (const skillName of names) {
    if (!existsSync(join(storeSkillDir(skillName), "SKILL.md"))) {
      issues.push({ severity: "error", skill: skillName, message: "skill does not exist" });
      continue;
    }
    issues.push(...(await inspectSkill(skillName)));
  }
  if (!name) issues.push(...(await unmanagedSkillIssues()));
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.length - errors;
  const invalidSkills = new Set(
    issues.filter((issue) => issue.severity === "error").map((issue) => issue.skill)
  ).size;
  return {
    checked: names.length,
    valid: Math.max(0, names.length - invalidSkills),
    errors,
    warnings,
    issues,
  };
}

export interface CheckOptions {
  json?: boolean;
}

export async function checkCommand(name: string | undefined, options: CheckOptions = {}): Promise<void> {
  const result = await inspectSkills(name);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    for (const issue of result.issues) {
      const marker = issue.severity === "error" ? pc.red("✗") : pc.yellow("•");
      console.log(`  ${marker} ${pc.bold(issue.skill)} ${issue.message}`);
    }
    if (result.issues.length > 0) console.log();
    const summary = `${result.valid}/${result.checked} valid skill(s) · ${result.errors} error(s) · ${result.warnings} warning(s)`;
    console.log(result.errors > 0 ? pc.red(summary) : pc.green(`✓ ${summary}`));
  }
  if (result.errors > 0) process.exitCode = 1;
}
