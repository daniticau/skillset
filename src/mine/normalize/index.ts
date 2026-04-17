/**
 * Dispatcher: envelope → normalized record.
 */

import type { ScrapeEnvelope } from "../../ingest/sessions/types.js";
import type { SessionMessage } from "../types.js";
import { normalizeClaudeCodeRecord } from "./claudeCode.js";
import { normalizeCodexRecord } from "./codex.js";
import { normalizeCursorRecord } from "./cursor.js";

export interface NormalizedRecord {
  message?: SessionMessage;
  cwd?: string;
}

export function normalizeRecord(env: ScrapeEnvelope): NormalizedRecord {
  switch (env.source) {
    case "claude-code":
      return normalizeClaudeCodeRecord(env.raw);
    case "codex":
      return normalizeCodexRecord(env.raw);
    case "cursor":
      return normalizeCursorRecord(env.raw);
    default:
      return {};
  }
}

export { normalizeClaudeCodeRecord, normalizeCodexRecord, normalizeCursorRecord };
