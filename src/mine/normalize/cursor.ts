/**
 * Normalize a single Cursor IDE session envelope record into a SessionMessage.
 *
 * A Cursor envelope's raw is either:
 *   { _composerData: { workspaceRootFsPath?, lastUpdatedAt?, ... } }  — first line
 *   { type: 1|2, text|richText, toolCalls?, timingInfo? }             — a bubble
 *
 * type=1 → user, type=2 → assistant.
 */

import type { SessionMessage } from "../types.js";
import { stripSystemBleed } from "./shared.js";

interface ComposerMeta {
  composerId?: string;
  workspaceRootFsPath?: string;
  lastUpdatedAt?: number;
}

interface CursorBubble {
  type?: number;
  text?: string;
  richText?: string;
  timingInfo?: { clientStartTime?: number };
  toolCalls?: Array<{ name?: string }>;
}

export interface NormalizedRecord {
  message?: SessionMessage;
  cwd?: string;
}

function firstString(...vals: Array<unknown>): string {
  for (const v of vals) {
    if (typeof v === "string" && v.length > 0) return v;
  }
  return "";
}

export function normalizeCursorRecord(raw: unknown): NormalizedRecord {
  if (!raw || typeof raw !== "object") return {};

  // Metadata wrapper (first line of each cursor session file)
  const meta = (raw as { _composerData?: ComposerMeta })._composerData;
  if (meta && typeof meta === "object") {
    const cwd =
      typeof meta.workspaceRootFsPath === "string" && meta.workspaceRootFsPath.length > 0
        ? meta.workspaceRootFsPath
        : undefined;
    return { cwd };
  }

  // Bubble
  const bubble = raw as CursorBubble;
  const role =
    bubble.type === 1 ? "user" : bubble.type === 2 ? "assistant" : undefined;
  if (!role) return {};

  const rawText = firstString(bubble.text, bubble.richText);
  const text = stripSystemBleed(rawText);

  const toolUses =
    Array.isArray(bubble.toolCalls)
      ? bubble.toolCalls
          .map((tc) => (typeof tc?.name === "string" ? tc.name : undefined))
          .filter((n): n is string => !!n)
      : [];

  if (!text && toolUses.length === 0) return {};

  const timestamp =
    typeof bubble.timingInfo?.clientStartTime === "number"
      ? new Date(bubble.timingInfo.clientStartTime).toISOString()
      : undefined;

  return {
    message: {
      role,
      text,
      timestamp,
      toolUses: toolUses.length > 0 ? toolUses : undefined,
    },
  };
}
