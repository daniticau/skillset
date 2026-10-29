import { existsSync } from "node:fs";
import { cp, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STORE_SKILLS_DIR } from "./paths.js";

/**
 * The skills `sks init` installs, so every agent can drive Skillset from the
 * start. Each lives as a real skill folder in the package's `skills/`
 * directory, with its supporting files.
 */
export const BUILTIN_SKILLS = ["skillify", "skillset-cli"] as const;

/**
 * Words that only appear in built-in copies from older releases. A copy that
 * holds one is ours and out of date, so init replaces it. Any other existing
 * copy is the user's and stays as it is.
 */
const STALE_MARKERS = ["sks tailor", "--managed", "sks promote"];

/** `skills/` sits next to `dist/` when bundled and two levels above this file in the source tree. */
function builtinSkillsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, "..", "skills"), join(here, "..", "..", "skills")]) {
    if (existsSync(join(candidate, BUILTIN_SKILLS[0], "SKILL.md"))) return candidate;
  }
  throw new Error("the built-in skills folder is missing from this install of Skillset");
}

async function ensureBuiltinSkill(source: string, name: string): Promise<{ name: string; path: string } | null> {
  const dest = join(STORE_SKILLS_DIR, name);
  const file = join(dest, "SKILL.md");
  if (existsSync(file)) {
    const current = await readFile(file, "utf8").catch(() => "");
    if (!STALE_MARKERS.some((marker) => current.includes(marker))) return null;
  }
  await cp(join(source, name), dest, { recursive: true, force: true });
  return { name, path: dest };
}

export async function ensureBuiltinSkills(): Promise<Array<{ name: string; path: string }>> {
  const source = builtinSkillsDir();
  const installed: Array<{ name: string; path: string }> = [];
  for (const name of BUILTIN_SKILLS) {
    const result = await ensureBuiltinSkill(source, name);
    if (result) installed.push(result);
  }
  return installed;
}
