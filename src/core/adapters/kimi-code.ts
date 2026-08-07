/**
 * Kimi Code adapter — mirrors canonical skills to Kimi's brand-specific user
 * skill directory. Kimi also discovers ~/.agents/skills, but using
 * ~/.kimi-code/skills keeps ownership explicit and follows Kimi Code's current
 * user-scope convention (including KIMI_CODE_HOME isolation semantics).
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_KIMI_SKILLS_DIR } from "../paths.js";
import type { AgentAdapter } from "./types.js";
import {
  hashMirrorSkillDir,
  listMirrorSkillDirs,
  mirrorSkillDir,
  mirrorSkillDirMtimeMs,
  readMirrorSkillDir,
  removeMirrorSkillDir,
} from "./skill-dir.js";

export const kimiCodeAdapter: AgentAdapter = {
  kind: "kimi-code",
  defaultPath: DEFAULT_KIMI_SKILLS_DIR,
  displayName: "Kimi Code",
  layout: "per-skill-dir",

  async detect() {
    const kimiHome = process.env.KIMI_CODE_HOME || join(homedir(), ".kimi-code");
    if (!existsSync(kimiHome)) return null;
    return { path: join(kimiHome, "skills") };
  },

  mirrorSkill: mirrorSkillDir,
  hashMirrorSkill: hashMirrorSkillDir,
  mirrorSkillMtimeMs: mirrorSkillDirMtimeMs,
  readMirrorSkill: readMirrorSkillDir,
  listMirrorSkills: listMirrorSkillDirs,
  removeMirrorSkill: removeMirrorSkillDir,
};
