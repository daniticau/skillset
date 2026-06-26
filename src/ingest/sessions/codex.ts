// Codex CLI scraper. Reads ~/.codex/session_index.jsonl as the manifest
// (id, thread_name, updated_at), filters by cursor.lastUpdatedAt, then reads
// the referenced rollout files under ~/.codex/sessions/YYYY/MM/DD/. Session
// files are keyed by UUID in their filename (rollout-<ts>-<uuid>.jsonl).

import { existsSync, statSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { MAX_FILE_SIZE_BYTES } from "../folder.js";
import type { CodexCursor, PerSourceResult } from "./types.js";
import { writeSessionJsonl } from "./writer.js";
import { parseJsonLinesStrict } from "./jsonl.js";

interface IndexEntry {
  id: string;
  thread_name?: string;
  updated_at: string;
}

export function discoverCodexRoot(home: string): string | null {
  const root = path.join(home, ".codex");
  return existsSync(root) ? root : null;
}

async function readIndex(indexPath: string): Promise<IndexEntry[]> {
  if (!existsSync(indexPath)) return [];
  const content = await readFile(indexPath, "utf8");
  const out: IndexEntry[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as IndexEntry;
      if (obj && typeof obj.id === "string" && typeof obj.updated_at === "string") {
        out.push(obj);
      }
    } catch {
      // skip malformed lines
    }
  }
  return out;
}

async function findSessionFile(sessionsDir: string, sessionId: string): Promise<string | null> {
  // rollout files are nested under YYYY/MM/DD; filename ends with `<sessionId>.jsonl`.
  async function walk(dir: string): Promise<string | null> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        const found = await walk(abs);
        if (found) return found;
      } else if (e.isFile() && e.name.endsWith(`${sessionId}.jsonl`)) {
        return abs;
      }
    }
    return null;
  }
  return walk(sessionsDir);
}

export async function scrapeCodex(
  root: string,
  cursor: CodexCursor,
  outDir: string,
  scrapedAt: string,
  full: boolean
): Promise<{ result: PerSourceResult; cursorNext: CodexCursor }> {
  const indexPath = path.join(root, "session_index.jsonl");
  const sessionsDir = path.join(root, "sessions");

  const entries = await readIndex(indexPath);
  if (entries.length === 0) {
    return {
      result: { source: "codex", available: false, sessionsWritten: 0, sessionsSkipped: 0, reason: "no session_index.jsonl" },
      cursorNext: cursor,
    };
  }

  const lastSeen = full ? undefined : cursor.lastUpdatedAt;
  const filtered = (lastSeen
    ? entries.filter((e) => e.updated_at > lastSeen)
    : entries
  ).sort((a, b) => a.updated_at.localeCompare(b.updated_at));

  let written = 0;
  let skipped = 0;
  let maxSeen = lastSeen ?? "";
  let earliestSkipped: string | undefined;

  const markSkipped = (entry: IndexEntry) => {
    skipped += 1;
    if (!earliestSkipped || entry.updated_at < earliestSkipped) {
      earliestSkipped = entry.updated_at;
    }
  };

  for (const entry of filtered) {
    const sessionFile = await findSessionFile(sessionsDir, entry.id);
    if (!sessionFile) {
      markSkipped(entry);
      continue;
    }
    try {
      const stat = statSync(sessionFile);
      if (stat.size > MAX_FILE_SIZE_BYTES) {
        markSkipped(entry);
        continue;
      }
    } catch {
      markSkipped(entry);
      continue;
    }

    let content: string;
    try {
      content = await readFile(sessionFile, "utf8");
    } catch {
      markSkipped(entry);
      continue;
    }

    const parsed = parseJsonLinesStrict(content);
    if (!parsed) {
      markSkipped(entry);
      continue;
    }

    await writeSessionJsonl(outDir, "codex", entry.id, entry.id, parsed, scrapedAt);
    written += 1;
    if (!earliestSkipped && entry.updated_at > maxSeen) maxSeen = entry.updated_at;
  }

  return {
    result: { source: "codex", available: true, sessionsWritten: written, sessionsSkipped: skipped },
    cursorNext: { lastUpdatedAt: maxSeen || cursor.lastUpdatedAt },
  };
}
