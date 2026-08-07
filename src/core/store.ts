import { cp, lstat, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { STORE_ROOT, STORE_SKILLS_DIR } from "./paths.js";
import { listSkillDirs, readSkillMd, validateSkillName } from "./skill.js";

export async function ensureStore(): Promise<void> {
  await mkdir(STORE_SKILLS_DIR, { recursive: true });
}

export function storeSkillDir(name: string): string {
  validateSkillName(name);
  return join(STORE_SKILLS_DIR, name);
}

export async function listStoreSkills(): Promise<string[]> {
  const dirs = await listSkillDirs(STORE_SKILLS_DIR);
  return dirs.map((d) => d.split(/[/\\]/).pop()!);
}

/**
 * Replace `dest` with a real, independent copy of `src`.
 *
 * Two deliberate choices, both learned from skills that are symlinked in from
 * elsewhere (a vendor app bundle, a separate repo):
 *
 *  - `dest` is unlinked, never recursed into, when it is a symlink. Recursively
 *    deleting through a link would delete the *target's* contents — which for a
 *    skill linked into /Applications/Some.app means destroying part of an
 *    installed application.
 *  - `dereference: true`, so the copy contains real files. Copying a link
 *    verbatim would leave the store holding a pointer into someone else's
 *    directory, and the next write-back would try to mutate it (and fail, or
 *    worse, succeed).
 */
export async function copyDirReplace(src: string, dest: string): Promise<void> {
  const link = await isSymlink(dest);
  if (link) {
    await rm(dest, { force: true });
  } else if (existsSync(dest)) {
    await rm(dest, { recursive: true, force: true });
  }
  await cp(src, dest, { recursive: true, dereference: true });
}

async function isSymlink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch {
    return false;
  }
}

export async function validateStoreSkill(name: string): Promise<void> {
  await readSkillMd(storeSkillDir(name));
}

export function storeRoot(): string {
  return STORE_ROOT;
}
