/**
 * Normalize a single Codex CLI session envelope record into a SessionMessage.
 *
 * Codex rollout JSONL is variable. This normalizer is deliberately permissive:
 * it handles the shapes observed in practice and falls back to skipping records
 * it can't interpret. The goal is resilience, not perfect coverage.
 */

import type { SessionMessage } from "../types.js";
import { stripSystemBleed } from "./shared.js";

interface CodexMessage {
  role?: "user" | "assistant" | "system";
  content?: unknown;
}

interface CodexRecord {
  type?: string;
  timestamp?: string;
  role?: "user" | "assistant" | "system" | "tool";
  content?: unknown;
  payload?: unknown;
  name?: string;
  arguments?: unknown;
  output?: unknown;
  message?: CodexMessage;
  cwd?: string;
  working_directory?: string;
}

export interface NormalizedRecord {
  message?: SessionMessage;
  cwd?: string;
}

function textFromContent(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return stripSystemBleed(content);
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const rawBlock of content) {
    if (!rawBlock || typeof rawBlock !== "object") continue;
    const block = rawBlock as { type?: string; text?: string; content?: unknown };
    if (block.type === "input_text" || block.type === "output_text" || block.type === "text") {
      if (typeof block.text === "string") {
        const cleaned = stripSystemBleed(block.text);
        if (cleaned) parts.push(cleaned);
      }
    } else if (typeof block.content === "string") {
      parts.push(block.content);
    }
  }
  return parts.join("\n");
}

export function normalizeCodexRecord(raw: unknown): NormalizedRecord {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as CodexRecord;
  const type = typeof r.type === "string" ? r.type : "";
  const timestamp = typeof r.timestamp === "string" ? r.timestamp : undefined;
  const cwd =
    (typeof r.cwd === "string" && r.cwd.length > 0 && r.cwd) ||
    (typeof r.working_directory === "string" && r.working_directory.length > 0
      ? r.working_directory
      : undefined);

  // Session meta record — carries cwd only, no message.
  if (type === "session_meta" || type === "session_info") {
    return { cwd };
  }

  // Typed user/agent messages (Codex's modern format)
  if (type === "user_message" || type === "message_user") {
    const text = textFromContent(r.content ?? r.payload);
    if (!text) return { cwd };
    return { cwd, message: { role: "user", text, timestamp } };
  }
  if (
    type === "agent_message" ||
    type === "message_assistant" ||
    type === "assistant_message"
  ) {
    const text = textFromContent(r.content ?? r.payload);
    if (!text) return { cwd };
    return { cwd, message: { role: "assistant", text, timestamp } };
  }

  // OpenAI-style nested { message: { role, content } }
  if (
    r.message &&
    (r.message.role === "user" || r.message.role === "assistant")
  ) {
    const text = textFromContent(r.message.content);
    if (!text) return { cwd };
    return { cwd, message: { role: r.message.role, text, timestamp } };
  }

  // Flat { role, content }
  if (r.role === "user" || r.role === "assistant") {
    const text = textFromContent(r.content);
    if (!text) return { cwd };
    return { cwd, message: { role: r.role, text, timestamp } };
  }

  // Tool calls — attributed to assistant
  if (type === "function_call" || type === "tool_call") {
    const name = typeof r.name === "string" ? r.name : undefined;
    if (!name) return { cwd };
    return {
      cwd,
      message: {
        role: "assistant",
        text: "",
        timestamp,
        toolUses: [name],
      },
    };
  }
  if (type === "function_call_output" || type === "tool_result") {
    const text =
      typeof r.output === "string"
        ? r.output
        : textFromContent(r.content ?? r.output);
    return {
      cwd,
      message: {
        role: "user",
        text: text.slice(0, 400),
        timestamp,
        isToolResult: true,
      },
    };
  }

  return { cwd };
}
