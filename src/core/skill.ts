import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import matter from "gray-matter";

export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
}

export interface ParsedSkill {
  frontmatter: SkillFrontmatter;
  body: string;
}

export class SkillValidationError extends Error {}

export function parseSkillMd(source: string): ParsedSkill {
  const { data, content } = matter(source);
  if (typeof data.name !== "string" || data.name.length === 0) {
    throw new SkillValidationError("SKILL.md frontmatter is missing `name`");
  }
  if (typeof data.description !== "string" || data.description.length === 0) {
    throw new SkillValidationError("SKILL.md frontmatter is missing `description`");
  }
  return {
    frontmatter: {
      name: data.name,
      description: data.description,
      license: typeof data.license === "string" ? data.license : undefined,
    },
    body: content,
  };
}

export async function readSkillMd(skillDir: string): Promise<ParsedSkill> {
  const path = join(skillDir, "SKILL.md");
  if (!existsSync(path)) {
    throw new SkillValidationError(`No SKILL.md at ${path}`);
  }
  return parseSkillMd(await readFile(path, "utf8"));
}

export async function listSkillDirs(skillsRoot: string): Promise<string[]> {
  if (!existsSync(skillsRoot)) return [];
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const dirs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (existsSync(join(skillsRoot, entry.name, "SKILL.md"))) {
      dirs.push(join(skillsRoot, entry.name));
    }
  }
  return dirs.sort();
}

export async function hashSkillDir(skillDir: string): Promise<string> {
  const files = await collectFiles(skillDir);
  const hash = createHash("sha256");
  for (const rel of files.sort()) {
    const abs = join(skillDir, rel);
    const buf = await readFile(abs);
    hash.update(rel);
    hash.update("\0");
    hash.update(buf);
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function collectFiles(root: string, base = root): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(root, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(abs, base)));
    } else if (entry.isFile()) {
      out.push(relative(base, abs).split("\\").join("/"));
    }
  }
  return out;
}

export async function skillDirExists(skillsRoot: string, name: string): Promise<boolean> {
  const dir = join(skillsRoot, name);
  if (!existsSync(dir)) return false;
  const s = await stat(dir);
  return s.isDirectory() && existsSync(join(dir, "SKILL.md"));
}
