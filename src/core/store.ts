import { cp, mkdir, rm } from "node:fs/promises";
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

export async function copyDirReplace(src: string, dest: string): Promise<void> {
  if (existsSync(dest)) {
    await rm(dest, { recursive: true, force: true });
  }
  await cp(src, dest, { recursive: true });
}

export async function validateStoreSkill(name: string): Promise<void> {
  await readSkillMd(storeSkillDir(name));
}

export function storeRoot(): string {
  return STORE_ROOT;
}
