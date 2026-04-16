// Cursor IDE scraper. Opens each Cursor SQLite state.vscdb read-only and
// enumerates composer sessions from two tables:
//   cursorDiskKV  key = 'composerData:<composerId>'   — session metadata
//                 key = 'bubbleId:<composerId>:<bubbleId>' — individual turns
//
// Output: one JSONL per composerId. Line 0 is the composerData record;
// subsequent lines are each bubble. Incremental via composerData.lastUpdatedAt
// (millis) per-composer; a composer whose lastUpdatedAt hasn't moved is
// skipped unless --full.

import { existsSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import type DatabaseType from "better-sqlite3";
import type { CursorIdeCursor, PerSourceResult } from "./types.js";
import { openReadOnly } from "./sqlite.js";
import { writeSessionJsonl } from "./writer.js";

export function discoverCursorDatabases(home: string = homedir()): string[] {
  const candidates: string[] = [];
  const base = path.join(home, "AppData", "Roaming", "Cursor", "User");
  const globalDb = path.join(base, "globalStorage", "state.vscdb");
  if (existsSync(globalDb)) candidates.push(globalDb);
  // workspace DBs only carry per-workspace state; the chat/composer data
  // itself lives in globalStorage. Skipping workspace-storage dbs keeps the
  // v1 scraper simple and avoids duplicate bubbles.
  return candidates;
}

interface ComposerRow {
  composerId: string;
  data: unknown;
  lastUpdatedAt: number;
}

function parseJsonBlob(value: unknown): unknown | null {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (value instanceof Uint8Array) {
    try {
      return JSON.parse(Buffer.from(value).toString("utf8"));
    } catch {
      return null;
    }
  }
  return null;
}

function extractLastUpdated(data: unknown): number {
  if (!data || typeof data !== "object") return 0;
  const d = data as Record<string, unknown>;
  const candidates = ["lastUpdatedAt", "updatedAt", "createdAt", "lastMessageAt"];
  for (const key of candidates) {
    const v = d[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Date.parse(v);
      if (!Number.isNaN(n)) return n;
    }
  }
  return 0;
}

function listComposers(db: DatabaseType.Database): ComposerRow[] {
  const rows = db
    .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'")
    .all() as Array<{ key: string; value: unknown }>;
  const out: ComposerRow[] = [];
  for (const r of rows) {
    const composerId = r.key.slice("composerData:".length);
    if (!composerId) continue;
    const data = parseJsonBlob(r.value);
    if (data === null) continue;
    out.push({ composerId, data, lastUpdatedAt: extractLastUpdated(data) });
  }
  return out;
}

function listBubbles(db: DatabaseType.Database, composerId: string): unknown[] {
  const rows = db
    .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE ? ORDER BY key")
    .all(`bubbleId:${composerId}:%`) as Array<{ key: string; value: unknown }>;
  const out: unknown[] = [];
  for (const r of rows) {
    const parsed = parseJsonBlob(r.value);
    if (parsed !== null) out.push(parsed);
  }
  return out;
}

export async function scrapeCursor(
  dbPaths: string[],
  cursor: CursorIdeCursor,
  outDir: string,
  scrapedAt: string,
  full: boolean
): Promise<{ result: PerSourceResult; cursorNext: CursorIdeCursor }> {
  if (dbPaths.length === 0) {
    return {
      result: { source: "cursor", available: false, sessionsWritten: 0, sessionsSkipped: 0, reason: "no Cursor state.vscdb found" },
      cursorNext: cursor,
    };
  }

  const lastSeen = full ? {} : cursor.lastUpdatedAtByComposer ?? {};
  const nextSeen: Record<string, number> = { ...lastSeen };

  let written = 0;
  let skipped = 0;
  let locked = 0;
  let unavailable = false;

  for (const dbPath of dbPaths) {
    const opened = await openReadOnly(dbPath);
    if (!opened.ok) {
      if (opened.reason === "locked") locked += 1;
      else if (opened.reason === "unavailable") unavailable = true;
      continue;
    }
    const { db } = opened;
    try {
      const composers = listComposers(db);
      for (const c of composers) {
        const prev = lastSeen[c.composerId] ?? 0;
        if (!full && c.lastUpdatedAt !== 0 && c.lastUpdatedAt <= prev) {
          skipped += 1;
          continue;
        }
        const bubbles = listBubbles(db, c.composerId);
        const records: unknown[] = [{ _composerData: c.data }, ...bubbles];
        await writeSessionJsonl(outDir, "cursor", c.composerId, c.composerId, records, scrapedAt);
        written += 1;
        nextSeen[c.composerId] = c.lastUpdatedAt || Date.now();
      }
    } finally {
      db.close();
    }
  }

  if (unavailable) {
    return {
      result: {
        source: "cursor",
        available: false,
        sessionsWritten: written,
        sessionsSkipped: skipped,
        locked,
        reason: "better-sqlite3 not installed or failed to load",
      },
      cursorNext: cursor,
    };
  }

  return {
    result: {
      source: "cursor",
      available: true,
      sessionsWritten: written,
      sessionsSkipped: skipped,
      locked,
    },
    cursorNext: { lastUpdatedAtByComposer: nextSeen },
  };
}
