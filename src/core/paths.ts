import { homedir } from "node:os";
import { join } from "node:path";

export const STORE_ROOT = join(homedir(), ".skillset");
export const STORE_SKILLS_DIR = join(STORE_ROOT, "skills");
export const SESSIONS_DIR = join(STORE_ROOT, "sessions");
export const USAGE_DIR = join(STORE_ROOT, "usage");
export const USAGE_EVENTS_FILE = join(USAGE_DIR, "events.jsonl");
export const CONFLICTS_DIR = join(STORE_ROOT, "conflicts");
export const REPORTS_DIR = join(STORE_ROOT, "reports");
export const CONFIG_FILE = join(STORE_ROOT, "config.json");
export const STATE_FILE = join(STORE_ROOT, "state.json");

export const DEFAULT_CLAUDE_SKILLS_DIR = join(homedir(), ".claude", "skills");
export const DEFAULT_CODEX_SKILLS_DIR = join(homedir(), ".codex", "skills");
export const DEFAULT_KIMI_SKILLS_DIR = join(homedir(), ".kimi-code", "skills");
export const DEFAULT_GROK_SKILLS_DIR = join(homedir(), ".grok", "skills");
export const DEFAULT_CURSOR_SKILLS_DIR = join(homedir(), ".cursor", "skills");
export const DEFAULT_AGENTS_SKILLS_DIR = join(homedir(), ".agents", "skills");
export const LEGACY_CODEX_SKILLS_DIR = DEFAULT_AGENTS_SKILLS_DIR;
