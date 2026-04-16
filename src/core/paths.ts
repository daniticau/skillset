import { homedir } from "node:os";
import { join } from "node:path";

export const STORE_ROOT = join(homedir(), ".skillset");
export const STORE_SKILLS_DIR = join(STORE_ROOT, "skills");
export const SESSIONS_DIR = join(STORE_ROOT, "sessions");
export const CONFIG_FILE = join(STORE_ROOT, "config.json");
export const STATE_FILE = join(STORE_ROOT, "state.json");

export const DEFAULT_CLAUDE_SKILLS_DIR = join(homedir(), ".claude", "skills");
