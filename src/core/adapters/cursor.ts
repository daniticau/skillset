/** Cursor reads user skills from ~/.cursor/skills in the standard SKILL.md directory format. */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CURSOR_SKILLS_DIR } from "../paths.js";
import type { AgentAdapter } from "./types.js";
import {
  hashMirrorSkillDir,
  listMirrorSkillDirs,
  mirrorSkillDir,
  mirrorSkillDirMtimeMs,
  readMirrorSkillDir,
  removeMirrorSkillDir,
} from "./skill-dir.js";

export const cursorAdapter: AgentAdapter = {
  kind: "cursor",
  defaultPath: DEFAULT_CURSOR_SKILLS_DIR,
  displayName: "Cursor",
  layout: "per-skill-dir",

  async detect() {
    const cursorHome = join(homedir(), ".cursor");
    if (!existsSync(cursorHome)) return null;
    return { path: DEFAULT_CURSOR_SKILLS_DIR };
  },

  mirrorSkill: mirrorSkillDir,
  hashMirrorSkill: hashMirrorSkillDir,
  mirrorSkillMtimeMs: mirrorSkillDirMtimeMs,
  readMirrorSkill: readMirrorSkillDir,
  listMirrorSkills: listMirrorSkillDirs,
  removeMirrorSkill: removeMirrorSkillDir,
};
