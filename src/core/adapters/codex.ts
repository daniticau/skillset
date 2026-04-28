/**
 * Codex adapter — mirrors canonical skills to the Codex user skills directory.
 *
 * Codex reads user skills from ~/.agents/skills/<skill-name>/SKILL.md. This is
 * separate from ~/.codex/AGENTS.md, which is global instruction guidance rather
 * than the Agent Skills store.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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
    const agentsHome = join(homedir(), ".agents");
    if (!existsSync(codexHome) && !existsSync(agentsHome)) return null;
    return { path: DEFAULT_CODEX_SKILLS_DIR };
  },

  mirrorSkill: mirrorSkillDir,
  hashMirrorSkill: hashMirrorSkillDir,
  mirrorSkillMtimeMs: mirrorSkillDirMtimeMs,
  readMirrorSkill: readMirrorSkillDir,
  listMirrorSkills: listMirrorSkillDirs,
  removeMirrorSkill: removeMirrorSkillDir,
};
