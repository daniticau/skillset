/**
 * Normalize a single Claude Code session envelope record into a SessionMessage.
 * Envelope.raw shape: SessionRecord (the original JSONL line).
 */

import type { SessionMessage, SessionRecord } from "../types.js";
import { extractText } from "./shared.js";

const SIGNAL_TYPES = new Set(["user", "assistant"]);

export interface NormalizedRecord {
  message?: SessionMessage;
  cwd?: string;
}

export function normalizeClaudeCodeRecord(raw: unknown): NormalizedRecord {
  if (!raw || typeof raw !== "object") return {};
  const record = raw as SessionRecord;

  const cwd =
    typeof record.cwd === "string" && record.cwd.length > 0 ? record.cwd : undefined;

  if (!SIGNAL_TYPES.has(record.type)) return { cwd };
  if (!record.message?.content) return { cwd };

  const { text, toolUses, isToolResult, isRejection } = extractText(
    record.message.content
  );
  // Skip empty tool results that are just confirmations
  if (isToolResult && !isRejection && text.length < 20) return { cwd };

  return {
    cwd,
    message: {
      role: record.message.role,
      text,
      timestamp: record.timestamp,
      toolUses: toolUses.length > 0 ? toolUses : undefined,
      isToolResult: isToolResult || undefined,
      isRejection: isRejection || undefined,
    },
  };
}
