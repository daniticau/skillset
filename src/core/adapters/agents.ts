/**
 * Generic `~/.agents/skills` adapter.
 *
 * `.agents/skills` is the vendor-neutral convention several agents read in
 * addition to their own brand directory — Kimi Code, for one, scans it as a
 * lower-precedence user skill root. Mirroring here covers any agent that
 * honours the convention without needing a dedicated adapter for each.
 *
 * This is also the directory Codex used before it moved to ~/.codex/skills, so
 * `LEGACY_CODEX_SKILLS_DIR` aliases the same path; the config migration that
 * repoints stale `codex` links only rewrites links whose agent is `codex`, so
 * an `agents` link pointing here is left alone.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_AGENTS_SKILLS_DIR } from "../paths.js";
import type { AgentAdapter } from "./types.js";
import {
  hashMirrorSkillDir,
  listMirrorSkillDirs,
  mirrorSkillDir,
  mirrorSkillDirMtimeMs,
  readMirrorSkillDir,
  removeMirrorSkillDir,
} from "./skill-dir.js";

export const agentsAdapter: AgentAdapter = {
  kind: "agents",
  defaultPath: DEFAULT_AGENTS_SKILLS_DIR,
  // Kept short: status/doctor pad agent names to a fixed 12-14 columns.
  displayName: "Generic",
  layout: "per-skill-dir",

  async detect() {
    const agentsHome = join(homedir(), ".agents");
    if (!existsSync(agentsHome)) return null;
    return { path: DEFAULT_AGENTS_SKILLS_DIR };
  },

  mirrorSkill: mirrorSkillDir,
  hashMirrorSkill: hashMirrorSkillDir,
  mirrorSkillMtimeMs: mirrorSkillDirMtimeMs,
  readMirrorSkill: readMirrorSkillDir,
  listMirrorSkills: listMirrorSkillDirs,
  removeMirrorSkill: removeMirrorSkillDir,
};
