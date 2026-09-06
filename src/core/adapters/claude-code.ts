import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_CLAUDE_SKILLS_DIR } from "../paths.js";
import type { AgentAdapter } from "./types.js";
import {
  hashMirrorSkillDir,
  listMirrorSkillDirs,
  mirrorSkillDir,
  mirrorSkillDirMtimeMs,
  readMirrorSkillDir,
  removeMirrorSkillDir,
} from "./skill-dir.js";

export const claudeCodeAdapter: AgentAdapter = {
  kind: "claude-code",
  defaultPath: DEFAULT_CLAUDE_SKILLS_DIR,
  displayName: "Claude Code",
  layout: "per-skill-dir",

  async detect() {
    // Claude Code creates ~/.claude/ on first run. If that exists, assume the
    // user has it (skills/ may not yet exist — created on first sync).
    const claudeDir = join(homedir(), ".claude");
    if (!existsSync(claudeDir)) return null;
    return { path: DEFAULT_CLAUDE_SKILLS_DIR };
  },

  instructionsFile: (root) => join(dirname(root), "CLAUDE.md"),

  mirrorSkill: mirrorSkillDir,
  hashMirrorSkill: hashMirrorSkillDir,
  mirrorSkillMtimeMs: mirrorSkillDirMtimeMs,
  readMirrorSkill: readMirrorSkillDir,
  listMirrorSkills: listMirrorSkillDirs,
  removeMirrorSkill: removeMirrorSkillDir,
};
