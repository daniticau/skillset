// Claude Code scraper. Walks ~/.claude/projects/<slug>/*.jsonl, where each
// file is one session (filename UUID = sessionId). Reuses the folder
// extractor for safety + incremental cursor; one output JSONL per session.

import path from "node:path";
import {
  extractFolderIncremental,
  normalizeFolderCursor,
} from "../folder.js";
import type { FolderCursor } from "../types.js";
import type { ClaudeCodeCursor, PerSourceResult } from "./types.js";
import { writeSessionJsonl } from "./writer.js";
import { parseJsonLinesStrict } from "./jsonl.js";

export async function scrapeClaudeCode(
  root: string,
  cursor: ClaudeCodeCursor,
  outDir: string,
  scrapedAt: string,
  full: boolean
): Promise<{ result: PerSourceResult; cursorNext: FolderCursor }> {
  const effectiveCursor = full ? {} : normalizeFolderCursor(root, cursor).cursor;
  const extraction = extractFolderIncremental(root, effectiveCursor);

  let written = 0;
  let skipped = 0;

  for (const file of extraction.files) {
    if (!file.path.endsWith(".jsonl")) {
      skipped += 1;
      continue;
    }

    const parsed = parseJsonLinesStrict(file.content);
    if (!parsed) {
      skipped += 1;
      continue;
    }

    const parts = file.path.split(/[\\/]+/);
    const projectSlug = parts.length > 1 ? parts[0] ?? "root" : "root";
    const basename = path.basename(file.path, ".jsonl");
    const sessionId = basename;
    const stem = `${projectSlug}__${basename}`;

    await writeSessionJsonl(outDir, "claude-code", sessionId, stem, parsed, scrapedAt);
    written += 1;
  }

  return {
    result: {
      source: "claude-code",
      available: true,
      sessionsWritten: written,
      sessionsSkipped: skipped,
    },
    cursorNext: extraction.cursor as FolderCursor,
  };
}
