/**
 * Session chunking — produces conversation windows suitable for LLM input.
 *
 * Strategy:
 * 1. Pre-filter around regex hits: if the heuristic layer flagged user messages,
 *    build a 5-message window centered on each hit.
 * 2. Fallback: for sessions with no hits but meaningful user content, sample
 *    windows around long-ish user messages.
 * 3. Respect token budgets.
 */

import type { ConversationWindow } from "./llm/prompts.js";
import type { ParsedSession, SessionMessage, Nugget } from "./types.js";
import { projectName } from "./reader.js";

const DEFAULT_WINDOW_SIZE = 5; // messages on each side of a hit
const DEFAULT_MAX_TOKENS = 2000; // budget per window
const MAX_WINDOWS_PER_SESSION = 20;
const MIN_USER_MESSAGE_LENGTH = 50;

export interface ChunkOptions {
  windowSize?: number;
  maxTokensPerWindow?: number;
  maxWindowsPerSession?: number;
}

/** Estimate token count. Rough heuristic: ~3.5 chars per token for English. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/** Truncate a message to fit a token budget. */
function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 3.5;
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.floor(maxChars)) + "…";
}

/** Indices of user messages that heuristics flagged (by checking evidence). */
function heuristicHitIndices(session: ParsedSession, heuristicNuggets: Nugget[]): Map<number, string[]> {
  const hits = new Map<number, string[]>();

  const myNuggets = heuristicNuggets.filter((n) =>
    n.evidence.some((ev) => ev.sessionId === session.sessionId)
  );
  if (myNuggets.length === 0) return hits;

  // Build a lookup of user message text → index
  const userTextToIndex = new Map<string, number>();
  session.messages.forEach((m, i) => {
    if (m.role !== "user" || m.isToolResult) return;
    const key = m.text.slice(0, 100); // match key used in nugget ids
    if (!userTextToIndex.has(key)) userTextToIndex.set(key, i);
  });

  for (const nugget of myNuggets) {
    for (const ev of nugget.evidence) {
      if (ev.sessionId !== session.sessionId) continue;
      const key = ev.userMessage.slice(0, 100);
      const idx = userTextToIndex.get(key);
      if (idx == null) continue;
      const existing = hits.get(idx) ?? [];
      if (!existing.includes(nugget.category)) existing.push(nugget.category);
      hits.set(idx, existing);
    }
  }

  return hits;
}

/** Build a window of messages centered on a specific index. */
function buildWindow(
  session: ParsedSession,
  centerIdx: number,
  windowSize: number,
  maxTokens: number,
  heuristicHits: string[]
): ConversationWindow {
  const start = Math.max(0, centerIdx - windowSize);
  const end = Math.min(session.messages.length, centerIdx + windowSize + 1);
  const slice = session.messages.slice(start, end);

  // Budget-aware truncation
  let budget = maxTokens;
  const truncated: Array<{ role: "user" | "assistant"; text: string }> = [];
  for (const m of slice) {
    if (m.isToolResult) continue; // skip tool results, they're noise for signal
    if (!m.text.trim()) continue;
    const tokens = estimateTokens(m.text);
    if (tokens > budget) {
      // Keep the message but truncate
      const truncatedText = truncateToTokens(m.text, Math.max(100, budget));
      truncated.push({ role: m.role, text: truncatedText });
      budget = 0;
      break;
    }
    truncated.push({ role: m.role, text: m.text });
    budget -= tokens;
  }

  return {
    sessionId: session.sessionId,
    project: projectName(session.cwd, session.projectSlug),
    messages: truncated,
    startIndex: start,
    heuristicHits,
  };
}

/** Chunk a session into conversation windows for LLM processing. */
export function chunkSession(
  session: ParsedSession,
  heuristicNuggets: Nugget[],
  options: ChunkOptions = {}
): ConversationWindow[] {
  const windowSize = options.windowSize ?? DEFAULT_WINDOW_SIZE;
  const maxTokens = options.maxTokensPerWindow ?? DEFAULT_MAX_TOKENS;
  const maxWindows = options.maxWindowsPerSession ?? MAX_WINDOWS_PER_SESSION;

  const hits = heuristicHitIndices(session, heuristicNuggets);
  const windows: ConversationWindow[] = [];

  // Primary: windows around heuristic hits
  const hitIndices = [...hits.keys()].sort((a, b) => a - b);
  const consumedIndices = new Set<number>();

  for (const idx of hitIndices) {
    if (consumedIndices.has(idx)) continue;
    const categories = hits.get(idx) ?? [];
    const window = buildWindow(session, idx, windowSize, maxTokens, categories);
    if (window.messages.length >= 2) {
      windows.push(window);
      // Mark the covered range as consumed to avoid overlap
      for (let i = Math.max(0, idx - windowSize); i <= idx + windowSize; i++) {
        consumedIndices.add(i);
      }
    }
    if (windows.length >= maxWindows) break;
  }

  // Secondary: if we have few/no hits but substantial user content, sample windows
  if (windows.length < maxWindows / 2) {
    for (let i = 0; i < session.messages.length; i++) {
      if (consumedIndices.has(i)) continue;
      const m = session.messages[i]!;
      if (m.role !== "user") continue;
      if (m.isToolResult) continue;
      if (m.text.length < MIN_USER_MESSAGE_LENGTH) continue;

      const window = buildWindow(session, i, windowSize, maxTokens, []);
      if (window.messages.length >= 2) {
        windows.push(window);
        for (let j = Math.max(0, i - windowSize); j <= i + windowSize; j++) {
          consumedIndices.add(j);
        }
      }
      if (windows.length >= maxWindows) break;
    }
  }

  return windows;
}
