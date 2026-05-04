/**
 * LLM-based signal extraction.
 *
 * Takes ParsedSessions and heuristic nuggets, chunks into windows,
 * calls the LLM, parses JSON, converts to Nuggets.
 */

import { createHash } from "node:crypto";
import type { ParsedSession, Nugget, NuggetCategory, LLMExtractionResult } from "./types.js";
import { chunkSession } from "./chunker.js";
import {
  chat,
  extractionSystemPrompt,
  extractionUserPrompt,
  parseLLMJson,
} from "./llm/index.js";
import type { LLMConfig, ConversationWindow } from "./llm/index.js";
import { focusForCategory } from "./focus.js";

const VALID_CATEGORIES: ReadonlySet<NuggetCategory> = new Set([
  "correction",
  "preference",
  "rejection",
  "workflow",
  "tool-pattern",
  "topic",
  "style",
  "anti-pattern",
]);

export interface LLMExtractProgress {
  windowsProcessed: number;
  windowsTotal: number;
  sessionsProcessed: number;
  sessionsTotal: number;
  signalsExtracted: number;
  parseFailures: number;
}

export interface LLMExtractOptions {
  maxWindowsPerSession?: number;
  temperature?: number;
  onProgress?: (progress: LLMExtractProgress) => void;
  concurrency?: number;
}

function hashId(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

function mistakeAssistantContext(window: ConversationWindow): string | undefined {
  const assistant = [...window.messages]
    .reverse()
    .find((message) => message.role === "assistant" && message.text.trim().length > 0);
  return assistant?.text.slice(0, 240);
}

async function extractFromWindow(
  window: ConversationWindow,
  config: LLMConfig,
  temperature: number
): Promise<Nugget[]> {
  const messages = [
    { role: "system" as const, content: extractionSystemPrompt() },
    { role: "user" as const, content: extractionUserPrompt(window) },
  ];

  const result = await chat(config, {
    messages,
    temperature,
    jsonMode: true,
    maxTokens: 1000,
  });

  const parsed = parseLLMJson<LLMExtractionResult>(result.content);
  if (!parsed || !Array.isArray(parsed.signals)) return [];

  const createdAt = new Date().toISOString();
  const nuggets: Nugget[] = [];

  for (const sig of parsed.signals) {
    if (!sig || typeof sig.signal !== "string") continue;
    if (!VALID_CATEGORIES.has(sig.category)) continue;
    if (sig.signal.length < 10) continue;
    const conf = typeof sig.confidence === "number" ? Math.min(1, Math.max(0, sig.confidence)) : 0.6;
    if (conf < 0.4) continue;
    const focus = focusForCategory(sig.category);
    const assistantContext =
      focus === "agent-mistake" ? mistakeAssistantContext(window) : undefined;
    const context = [assistantContext ? `[assistant context] ${assistantContext}` : "", sig.reasoning ?? ""]
      .filter(Boolean)
      .join("\n");

    nuggets.push({
      id: hashId(`llm:${sig.category}:${sig.signal.slice(0, 100)}`),
      category: sig.category,
      focus,
      signal: sig.signal,
      evidence: [
        {
          sessionId: window.sessionId,
          project: window.project,
          userMessage: window.messages
            .filter((m) => m.role === "user")
            .map((m) => m.text)
            .join(" / ")
            .slice(0, 400),
          context: context || undefined,
        },
      ],
      project: window.project,
      confidence: conf,
      source: "llm",
      createdAt,
      validatedByLLM: true,
    });
  }

  return nuggets;
}

/**
 * Run LLM extraction across all sessions.
 * Returns the LLM-extracted nuggets (to be merged with heuristic nuggets by the caller).
 */
export async function llmExtractFromSessions(
  sessions: ParsedSession[],
  heuristicNuggets: Nugget[],
  config: LLMConfig,
  options: LLMExtractOptions = {}
): Promise<{ nuggets: Nugget[]; progress: LLMExtractProgress }> {
  const temperature = options.temperature ?? 0.3;
  const concurrency = Math.max(1, options.concurrency ?? 2);

  // Collect all windows first so progress reporting is accurate
  const allWindows: ConversationWindow[] = [];
  for (const session of sessions) {
    const windows = chunkSession(session, heuristicNuggets, {
      maxWindowsPerSession: options.maxWindowsPerSession,
    });
    allWindows.push(...windows);
  }

  const progress: LLMExtractProgress = {
    windowsProcessed: 0,
    windowsTotal: allWindows.length,
    sessionsProcessed: 0,
    sessionsTotal: sessions.length,
    signalsExtracted: 0,
    parseFailures: 0,
  };

  const nuggets: Nugget[] = [];
  const sessionsSeen = new Set<string>();

  // Simple concurrency pool
  let cursor = 0;
  async function worker() {
    while (cursor < allWindows.length) {
      const myIdx = cursor++;
      const window = allWindows[myIdx];
      if (!window) break;
      try {
        const extracted = await extractFromWindow(window, config, temperature);
        nuggets.push(...extracted);
        progress.signalsExtracted += extracted.length;
      } catch {
        progress.parseFailures += 1;
      }
      progress.windowsProcessed += 1;
      if (!sessionsSeen.has(window.sessionId)) {
        sessionsSeen.add(window.sessionId);
        progress.sessionsProcessed += 1;
      }
      options.onProgress?.(progress);
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  return { nuggets, progress };
}
