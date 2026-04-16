// Atomic JSONL writer for scraped sessions. One file per session:
//   <outDir>/<source>/<filename>.jsonl
// Each line is a ScrapeEnvelope<T>. Writes go to a tmp file + rename so a
// crash mid-write never leaves a half-formed file in place.

import { mkdir, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { ScrapeEnvelope, ScrapeSource } from "./types.js";

export function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/\.{2,}/g, "_")   // collapse runs of dots to avoid traversal-ish names
    .replace(/^\.+/, "_")
    .slice(0, 200);
}

export async function writeSessionJsonl<T>(
  outDir: string,
  source: ScrapeSource,
  sessionId: string,
  filenameStem: string,
  records: T[],
  scrapedAt: string
): Promise<{ path: string; bytes: number; records: number }> {
  const sourceDir = path.join(outDir, source);
  await mkdir(sourceDir, { recursive: true });

  const finalPath = path.join(sourceDir, `${sanitizeFilename(filenameStem)}.jsonl`);
  const tmpPath = `${finalPath}.${randomUUID()}.tmp`;

  const lines = records.map((raw) => {
    const env: ScrapeEnvelope<T> = { source, sessionId, scrapedAt, raw };
    return JSON.stringify(env);
  });
  const body = lines.length > 0 ? lines.join("\n") + "\n" : "";

  await writeFile(tmpPath, body, "utf8");
  await rename(tmpPath, finalPath);

  return { path: finalPath, bytes: Buffer.byteLength(body, "utf8"), records: records.length };
}
