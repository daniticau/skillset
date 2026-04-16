// Thin wrapper around better-sqlite3. Opens DBs read-only and classifies the
// common failure modes into a single result type so callers can skip and
// continue rather than throwing mid-scrape.

import type DatabaseType from "better-sqlite3";

export type OpenResult =
  | { ok: true; db: DatabaseType.Database }
  | { ok: false; reason: "locked" | "missing" | "unavailable" | "unreadable"; error?: unknown };

let cachedCtor: typeof DatabaseType | null | undefined;

async function loadCtor(): Promise<typeof DatabaseType | null> {
  if (cachedCtor !== undefined) return cachedCtor;
  try {
    const mod = (await import("better-sqlite3")) as { default: typeof DatabaseType };
    cachedCtor = mod.default;
  } catch {
    cachedCtor = null;
  }
  return cachedCtor;
}

export async function openReadOnly(dbPath: string): Promise<OpenResult> {
  const Ctor = await loadCtor();
  if (!Ctor) return { ok: false, reason: "unavailable" };
  try {
    const db = new Ctor(dbPath, { readonly: true, fileMustExist: true });
    return { ok: true, db };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/SQLITE_BUSY|SQLITE_LOCKED|database is locked/i.test(msg)) {
      return { ok: false, reason: "locked", error: err };
    }
    if (/does not exist|ENOENT/i.test(msg)) {
      return { ok: false, reason: "missing", error: err };
    }
    return { ok: false, reason: "unreadable", error: err };
  }
}
