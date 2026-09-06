/**
 * Codex adapter — mirrors canonical skills to the Codex user skills directory.
 *
 * Codex reads user skills from ~/.codex/skills/<skill-name>/SKILL.md. This is
 * separate from ~/.codex/AGENTS.md, which is global instruction guidance rather
 * than the Agent Skills store.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_CODEX_SKILLS_DIR } from "../paths.js";
import type { AgentAdapter } from "./types.js";
import {
  hashMirrorSkillDir,
  listMirrorSkillDirs,
  mirrorSkillDir,
  mirrorSkillDirMtimeMs,
  readMirrorSkillDir,
  removeMirrorSkillDir,
} from "./skill-dir.js";

export const codexAdapter: AgentAdapter = {
  kind: "codex",
  defaultPath: DEFAULT_CODEX_SKILLS_DIR,
  displayName: "Codex",
  layout: "per-skill-dir",

  async detect() {
    const codexHome = join(homedir(), ".codex");
    if (existsSync(codexHome)) return { path: DEFAULT_CODEX_SKILLS_DIR };
    return null;
  },

  instructionsFile: (root) => join(dirname(root), "AGENTS.md"),

  mirrorSkill: mirrorSkillDir,
  hashMirrorSkill: hashMirrorSkillDir,
  mirrorSkillMtimeMs: mirrorSkillDirMtimeMs,
  readMirrorSkill: readMirrorSkillDir,
  listMirrorSkills: listMirrorSkillDirs,
  removeMirrorSkill: removeMirrorSkillDir,
};
