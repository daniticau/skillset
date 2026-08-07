/** Grok CLI user skills live in ~/.grok/skills and use the standard SKILL.md directory format. */
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentAdapter } from "./types.js";
import {
  hashMirrorSkillDir,
  listMirrorSkillDirs,
  mirrorSkillDir,
  mirrorSkillDirMtimeMs,
  readMirrorSkillDir,
  removeMirrorSkillDir,
} from "./skill-dir.js";

/**
 * Skills Grok ships with itself.
 *
 * Read from Grok's own bundle directory rather than hardcoded, so the list stays
 * correct as Grok adds or renames its built-ins. `help` and a few others are
 * extracted into the user skills root at install time without appearing under
 * `bundled/`, so those are named explicitly as a floor.
 */
const GROK_KNOWN_BUILTINS = ["help", "imagine", "check-work", "create-skill", "code-review"];

async function grokVendorSkills(): Promise<string[]> {
  const bundled = join(homedir(), ".grok", "bundled", "skills");
  const names = new Set(GROK_KNOWN_BUILTINS);
  try {
    for (const entry of await readdir(bundled, { withFileTypes: true })) {
      if (entry.isDirectory() || entry.isSymbolicLink()) names.add(entry.name);
    }
  } catch {
    // Bundle dir missing — fall back to the known builtins.
  }
  return [...names].sort();
}

export const grokAdapter: AgentAdapter = {
  kind: "grok",
  defaultPath: join(homedir(), ".grok", "skills"),
  displayName: "Grok CLI",
  layout: "per-skill-dir",
  async detect() {
    const grokHome = join(homedir(), ".grok");
    return existsSync(grokHome) ? { path: join(grokHome, "skills") } : null;
  },
  mirrorSkill: mirrorSkillDir,
  hashMirrorSkill: hashMirrorSkillDir,
  mirrorSkillMtimeMs: mirrorSkillDirMtimeMs,
  readMirrorSkill: readMirrorSkillDir,
  listMirrorSkills: listMirrorSkillDirs,
  vendorSkills: grokVendorSkills,
  removeMirrorSkill: removeMirrorSkillDir,
};
