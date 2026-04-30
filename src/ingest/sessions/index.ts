// Scrape dispatcher. Runs each per-source extractor serially, updates state
// cursors, returns a summary. Phase 2 (mining/scoring) will read from the
// output dir; this layer is intentionally dumb.

import { homedir } from "node:os";
import { discoverClaudeCodeHistory } from "../discovery.js";
import { discoverCodexRoot, scrapeCodex } from "./codex.js";
import { scrapeClaudeCode } from "./claudeCode.js";
import type {
  PerSourceResult,
  ScrapeCursors,
  ScrapeOptions,
  ScrapeSource,
  ScrapeSummary,
} from "./types.js";

function keep(source: ScrapeSource, opts: ScrapeOptions): boolean {
  return !opts.source || opts.source === source;
}

export async function scrapeAll(
  outDir: string,
  cursors: ScrapeCursors,
  opts: ScrapeOptions
): Promise<{ summary: ScrapeSummary; nextCursors: ScrapeCursors }> {
  const start = Date.now();
  const scrapedAt = new Date().toISOString();
  const full = opts.full === true;
  const perSource: PerSourceResult[] = [];
  const nextCursors: ScrapeCursors = { ...cursors };

  if (keep("claude-code", opts)) {
    const root = discoverClaudeCodeHistory();
    if (!root) {
      perSource.push({
        source: "claude-code", available: false, sessionsWritten: 0, sessionsSkipped: 0,
        reason: "~/.claude/projects not found",
      });
    } else {
      const { result, cursorNext } = await scrapeClaudeCode(
        root, cursors.claudeCode ?? {}, outDir, scrapedAt, full
      );
      perSource.push(result);
      nextCursors.claudeCode = cursorNext;
    }
  }

  if (keep("codex", opts)) {
    const root = discoverCodexRoot(homedir());
    if (!root) {
      perSource.push({
        source: "codex", available: false, sessionsWritten: 0, sessionsSkipped: 0,
        reason: "~/.codex not found",
      });
    } else {
      const { result, cursorNext } = await scrapeCodex(
        root, cursors.codex ?? {}, outDir, scrapedAt, full
      );
      perSource.push(result);
      nextCursors.codex = cursorNext;
    }
  }

  return {
    summary: { perSource, totalMs: Date.now() - start },
    nextCursors,
  };
}

export { discoverCodexRoot } from "./codex.js";
export type { ScrapeEnvelope, ScrapeSource, ScrapeOptions, ScrapeSummary, PerSourceResult, ScrapeCursors } from "./types.js";
