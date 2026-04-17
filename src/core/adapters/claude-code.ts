import { existsSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CLAUDE_SKILLS_DIR, STORE_SKILLS_DIR } from "../paths.js";
import type { AgentAdapter } from "./types.js";
import type { ParsedSkill } from "../skill.js";
import { hashSkillDir, readSkillMd } from "../skill.js";
import { copyDirReplace } from "../store.js";

function mirrorDirFor(root: string, name: string): string {
  return join(root, name);
}

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

  async mirrorSkill(skill: ParsedSkill, targetRoot: string): Promise<string> {
    await mkdir(targetRoot, { recursive: true });
    const src = join(STORE_SKILLS_DIR, skill.frontmatter.name);
    const dest = mirrorDirFor(targetRoot, skill.frontmatter.name);
    // Copy the whole canonical dir so multi-file skills (meta.json, assets, etc.)
    // arrive intact in Claude Code's skills dir.
    await copyDirReplace(src, dest);
    return dest;
  },

  async hashMirrorSkill(name: string, targetRoot: string): Promise<string | null> {
    const dir = mirrorDirFor(targetRoot, name);
    if (!existsSync(join(dir, "SKILL.md"))) return null;
    return hashSkillDir(dir);
  },

  async readMirrorSkill(name: string, targetRoot: string): Promise<ParsedSkill | null> {
    const dir = mirrorDirFor(targetRoot, name);
    if (!existsSync(join(dir, "SKILL.md"))) return null;
    return readSkillMd(dir);
  },

  async listMirrorSkills(targetRoot: string): Promise<string[]> {
    if (!existsSync(targetRoot)) return [];
    const entries = await readdir(targetRoot, { withFileTypes: true });
    const out: string[] = [];
    for (const e of entries) {
      if (e.isDirectory() && existsSync(join(targetRoot, e.name, "SKILL.md"))) {
        out.push(e.name);
      }
    }
    return out.sort();
  },

  async removeMirrorSkill(name: string, targetRoot: string): Promise<void> {
    const dir = mirrorDirFor(targetRoot, name);
    if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
  },
};
