// Session-scrape shapes. Raw-per-source: each source's native record is kept
// verbatim inside a thin envelope so the mining layer (phase 2) can normalize
// later without losing information.

import type { FolderCursor } from "../types.js";

export type ScrapeSource = "claude-code" | "codex";

export interface ScrapeEnvelope<T = unknown> {
  source: ScrapeSource;
  sessionId: string;
  scrapedAt: string;
  raw: T;
}

export interface ScrapeOptions {
  source?: ScrapeSource;
  full?: boolean;
}

export interface PerSourceResult {
  source: ScrapeSource;
  available: boolean;
  sessionsWritten: number;
  sessionsSkipped: number;
  locked?: number;
  reason?: string;
}

export interface ScrapeSummary {
  perSource: PerSourceResult[];
  totalMs: number;
}

export interface ClaudeCodeCursor extends FolderCursor {}

export interface CodexCursor {
  lastUpdatedAt?: string;
}

export interface ScrapeCursors {
  claudeCode?: ClaudeCodeCursor;
  codex?: CodexCursor;
}
