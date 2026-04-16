import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CLAUDE_SKILLS_DIR } from "../paths.js";
import type { AgentAdapter } from "./types.js";

export const claudeCodeAdapter: AgentAdapter = {
  kind: "claude-code",
  defaultPath: DEFAULT_CLAUDE_SKILLS_DIR,
  displayName: "Claude Code",
  async detect() {
    // Claude Code creates ~/.claude/ the first time it runs. If the dir exists,
    // the user has it installed (or at least configured) — skills/ may not exist
    // yet, but we'll create it on first sync.
    const claudeDir = join(homedir(), ".claude");
    if (!existsSync(claudeDir)) return null;
    return { path: DEFAULT_CLAUDE_SKILLS_DIR };
  },
};
