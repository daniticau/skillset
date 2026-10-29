import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import matter from "gray-matter";

/**
 * Authorship of a skill. Determines whether automation may modify it.
 *  - user-created: authored by the user (directly, or adopted from a mirror the user populated).
 *    NEVER touched by automation. Can still participate in conflict reports but no state change is applied.
 *  - auto-created: added by an agent rather than the user, through the `managed` add path or an older release.
 *    Eligible for agent edits unless the user has edited it since.
 */
export type SkillOrigin = "user-created" | "auto-created";

export const SKILL_ORIGINS: readonly SkillOrigin[] = ["user-created", "auto-created"];

export function isSkillOrigin(v: unknown): v is SkillOrigin {
  return v === "user-created" || v === "auto-created";
}

export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  /**
   * Authorship — determines automation's right to modify. Missing on legacy skills written
   * before origin tracking existed; treat as "user-created" for conservative safety.
   */
  origin?: SkillOrigin;
  /**
   * Always-on. The body is also written into a managed block of every connected
   * agent's global instructions file (CLAUDE.md, AGENTS.md), so it applies to
   * every session without waiting for a description match. A triggered skill
   * can be missed; an always-on one cannot. It costs tokens on every turn, so
   * keep these short and absolute: never do X, always do Y.
   */
  always?: boolean;
}

export interface ParsedSkill {
  frontmatter: SkillFrontmatter;
  body: string;
}

export class SkillValidationError extends Error {}

export const SKILL_NAME_PATTERN = /^(?!.*--)[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

export function validateSkillName(name: string): void {
  if (!SKILL_NAME_PATTERN.test(name)) {
    throw new SkillValidationError(
      "SKILL.md frontmatter `name` must be kebab-case using lowercase letters, numbers, and single hyphens"
    );
  }
}

export function parseSkillMd(source: string): ParsedSkill {
  const { data, content } = matter(source);
  if (typeof data.name !== "string" || data.name.length === 0) {
    throw new SkillValidationError("SKILL.md frontmatter is missing `name`");
  }
  validateSkillName(data.name);
  if (typeof data.description !== "string" || data.description.length === 0) {
    throw new SkillValidationError("SKILL.md frontmatter is missing `description`");
  }
  let origin: SkillOrigin | undefined;
  if (data.origin !== undefined && data.origin !== null) {
    if (!isSkillOrigin(data.origin)) {
      throw new SkillValidationError(
        `SKILL.md frontmatter \`origin\` must be one of ${SKILL_ORIGINS.join("|")}, got ${JSON.stringify(data.origin)}`
      );
    }
    origin = data.origin;
  }
  let always: boolean | undefined;
  if (data.always !== undefined && data.always !== null) {
    if (typeof data.always !== "boolean") {
      throw new SkillValidationError(
        `SKILL.md frontmatter \`always\` must be true or false, got ${JSON.stringify(data.always)}`
      );
    }
    always = data.always;
  }
  return {
    frontmatter: {
      name: data.name,
      description: data.description,
      license: typeof data.license === "string" ? data.license : undefined,
      origin,
      always,
    },
    body: content,
  };
}

/**
 * Render a SKILL.md with stable frontmatter ordering (name → description → always → origin → license).
 * Trailing newline included. Used by mirror / make / synthesize so the on-disk format is uniform.
 */
export function renderSkillMd(frontmatter: SkillFrontmatter, body: string): string {
  validateSkillName(frontmatter.name);
  const fm: string[] = [
    "---",
    `name: ${frontmatter.name}`,
    `description: ${JSON.stringify(frontmatter.description)}`,
  ];
  if (frontmatter.always) fm.push("always: true");
  if (frontmatter.origin) fm.push(`origin: ${frontmatter.origin}`);
  if (frontmatter.license) fm.push(`license: ${JSON.stringify(frontmatter.license)}`);
  fm.push("---");
  return fm.join("\n") + "\n\n" + body.trim() + "\n";
}


export async function readSkillMd(skillDir: string): Promise<ParsedSkill> {
  const path = join(skillDir, "SKILL.md");
  if (!existsSync(path)) {
    throw new SkillValidationError(`No SKILL.md at ${path}`);
  }
  return parseSkillMd(await readFile(path, "utf8"));
}

/**
 * Directory test that follows symlinks.
 *
 * `readdir(..., { withFileTypes: true })` reports a symlink as a symlink, never
 * as the directory it points at, so a plain `entry.isDirectory()` silently skips
 * linked-in skills. Symlinking a skill into an agent's skills dir is a normal
 * way to install one, so those must be treated as real skill directories.
 */
export async function isDirectoryFollowingLinks(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    // Broken symlink, or a race with a concurrent delete.
    return false;
  }
}

export async function listSkillDirs(skillsRoot: string): Promise<string[]> {
  if (!existsSync(skillsRoot)) return [];
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const dirs: string[] = [];
  for (const entry of entries) {
    const abs = join(skillsRoot, entry.name);
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.isSymbolicLink() && !(await isDirectoryFollowingLinks(abs))) continue;
    if (existsSync(join(abs, "SKILL.md"))) {
      dirs.push(abs);
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

async function collectFiles(
  root: string,
  base = root,
  seen = new Set<string>()
): Promise<string[]> {
  // Guard against symlink cycles, which would otherwise recurse forever now
  // that linked directories are followed.
  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch {
    return [];
  }
  if (seen.has(realRoot)) return [];
  seen.add(realRoot);

  const out: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(root, entry.name);
    const isDir = entry.isSymbolicLink()
      ? await isDirectoryFollowingLinks(abs)
      : entry.isDirectory();
    if (isDir) {
      out.push(...(await collectFiles(abs, base, seen)));
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      // A symlink that isn't a directory resolves to file content for hashing.
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
