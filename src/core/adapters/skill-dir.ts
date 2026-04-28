import { existsSync } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ParsedSkill } from "../skill.js";
import { hashSkillDir, readSkillMd } from "../skill.js";
import { STORE_SKILLS_DIR } from "../paths.js";
import { copyDirReplace } from "../store.js";

function mirrorDirFor(root: string, name: string): string {
  return join(root, name);
}

export async function mirrorSkillDir(
  skill: ParsedSkill,
  targetRoot: string
): Promise<string> {
  await mkdir(targetRoot, { recursive: true });
  const src = join(STORE_SKILLS_DIR, skill.frontmatter.name);
  const dest = mirrorDirFor(targetRoot, skill.frontmatter.name);
  // Copy the whole canonical dir so multi-file skills (assets, scripts,
  // references, etc.) arrive intact in agents that support the SKILL.md format.
  await copyDirReplace(src, dest);
  return dest;
}

export async function hashMirrorSkillDir(
  name: string,
  targetRoot: string
): Promise<string | null> {
  const dir = mirrorDirFor(targetRoot, name);
  if (!existsSync(join(dir, "SKILL.md"))) return null;
  return hashSkillDir(dir);
}

export async function mirrorSkillDirMtimeMs(
  name: string,
  targetRoot: string
): Promise<number | null> {
  const skillFile = join(mirrorDirFor(targetRoot, name), "SKILL.md");
  if (!existsSync(skillFile)) return null;
  const s = await stat(skillFile);
  return s.mtimeMs;
}

export async function readMirrorSkillDir(
  name: string,
  targetRoot: string
): Promise<ParsedSkill | null> {
  const dir = mirrorDirFor(targetRoot, name);
  if (!existsSync(join(dir, "SKILL.md"))) return null;
  return readSkillMd(dir);
}

export async function listMirrorSkillDirs(targetRoot: string): Promise<string[]> {
  if (!existsSync(targetRoot)) return [];
  const entries = await readdir(targetRoot, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    if (e.isDirectory() && existsSync(join(targetRoot, e.name, "SKILL.md"))) {
      out.push(e.name);
    }
  }
  return out.sort();
}

export async function removeMirrorSkillDir(
  name: string,
  targetRoot: string
): Promise<void> {
  const dir = mirrorDirFor(targetRoot, name);
  if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
}
