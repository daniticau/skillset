// Discovery helpers forked from nia-cli (src/commands/personal.ts, MIT). Only
// coding-session sources are included; non-coding sources (Obsidian, Chrome,
// Firefox, Apple Notes, Photos, etc.) are out of scope for skillset.
//
// Each helper reads `homedir()` at call time so tests can override HOME /
// USERPROFILE — matches the contract used in upstream.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export interface SessionSource {
  kind: "claude-code" | "codex" | "vscode";
  path: string;
  description: string;
}

export function discoverClaudeCodeHistory(): string | null {
  const root = path.join(homedir(), ".claude", "projects");
  return existsSync(root) ? root : null;
}

export function discoverCodexHistory(): string | null {
  const root = path.join(homedir(), ".codex");
  return existsSync(root) ? root : null;
}

// Discovers every coding-session source currently present on this machine.
export function discoverSessionSources(): SessionSource[] {
  const sources: SessionSource[] = [];

  const claudeCode = discoverClaudeCodeHistory();
  if (claudeCode) {
    sources.push({
      kind: "claude-code",
      path: claudeCode,
      description: "Claude Code conversation transcripts (~/.claude/projects)",
    });
  }

  const codex = discoverCodexHistory();
  if (codex) {
    sources.push({
      kind: "codex",
      path: codex,
      description: "Codex CLI rollout sessions (~/.codex/sessions)",
    });
  }

  return sources;
}
