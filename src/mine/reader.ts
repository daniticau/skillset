/**
 * Session reader — walks the scrape store (~/.skillset/sessions/<source>/*.jsonl)
 * and normalizes each agent's envelope format into ParsedSession.
 *
 * Each file contains lines of ScrapeEnvelope<unknown>. All envelopes in a file
 * share the same sessionId and source; the raw payload is agent-specific and
 * gets dispatched to the matching normalizer under ./normalize/.
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import type { ParsedSession, SessionMessage } from "./types.js";
import type { ScrapeEnvelope, ScrapeSource } from "../ingest/sessions/types.js";
import { SESSIONS_DIR } from "../core/paths.js";
import { parseJsonLinesLenient } from "../ingest/sessions/jsonl.js";
import { normalizeRecord } from "./normalize/index.js";

const SOURCES: ScrapeSource[] = ["claude-code", "codex"];

interface SourceSessionFile {
  source: ScrapeSource;
  path: string;
}

function listSourceFiles(source: ScrapeSource): SourceSessionFile[] {
  const dir = join(SESSIONS_DIR, source);
  if (!existsSync(dir)) return [];
  const out: SourceSessionFile[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      out.push({ source, path: join(dir, entry.name) });
    }
  }
  return out;
}

/**
 * Infer a project slug from the scrape filename stem.
 * Claude-code stems are `<projectSlug>__<basename>`; codex stems are the
 * sessionId alone, so we fall back to the source name as the slug.
 */
function deriveProjectSlug(source: ScrapeSource, filenameStem: string): string {
  if (source === "claude-code") {
    const split = filenameStem.indexOf("__");
    if (split > 0) return filenameStem.slice(0, split);
  }
  return source;
}

function parseSessionFile(file: SourceSessionFile): ParsedSession | null {
  let raw: string;
  try {
    raw = readFileSync(file.path, "utf8");
  } catch {
    return null;
  }

  // Hash while the content is already in memory — matches sessionFileHash()
  // so incremental-state consumers don't have to re-read the file.
  const fileHash = createHash("sha256").update(raw).digest("hex").slice(0, 16);

  const messages: SessionMessage[] = [];
  let cwd: string | undefined;
  let sessionId: string | undefined;

  for (const env of parseJsonLinesLenient<ScrapeEnvelope>(raw)) {
    if (!env || env.source !== file.source) continue;
    if (!sessionId && typeof env.sessionId === "string") {
      sessionId = env.sessionId;
    }
    const { message, cwd: foundCwd } = normalizeRecord(env);
    if (!cwd && foundCwd) cwd = foundCwd;
    if (message) messages.push(message);
  }

  if (!messages.some((m) => m.role === "user" && !m.isToolResult)) {
    return null;
  }

  const stem = basename(file.path, ".jsonl");
  const projectSlug = deriveProjectSlug(file.source, stem);

  return {
    sessionId: sessionId ?? stem,
    projectSlug,
    filePath: file.path,
    fileHash,
    messages,
    cwd,
    source: file.source,
  };
}

export interface ReadOptions {
  source?: ScrapeSource;
}

/**
 * Read every session from the scrape store. Optional project filter matches
 * against both the projectSlug and the resolved project name.
 */
export function readAllSessions(
  filterProject?: string,
  opts: ReadOptions = {}
): ParsedSession[] {
  const sources = opts.source ? [opts.source] : SOURCES;
  const sessions: ParsedSession[] = [];
  for (const source of sources) {
    for (const file of listSourceFiles(source)) {
      const parsed = parseSessionFile(file);
      if (!parsed) continue;
      if (filterProject && !matchesProjectFilter(parsed, filterProject)) continue;
      sessions.push(parsed);
    }
  }

  // Sort newest first by the last message timestamp in each session.
  sessions.sort((a, b) => {
    const ta = lastTimestamp(a) ?? "";
    const tb = lastTimestamp(b) ?? "";
    return tb.localeCompare(ta);
  });

  return sessions;
}

function lastTimestamp(session: ParsedSession): string | undefined {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const ts = session.messages[i]?.timestamp;
    if (ts) return ts;
  }
  return undefined;
}

function matchesProjectFilter(session: ParsedSession, filter: string): boolean {
  const lower = filter.toLowerCase();
  if (session.projectSlug.toLowerCase().includes(lower)) return true;
  const name = projectName(session.cwd, session.projectSlug, session.source);
  return name.toLowerCase().includes(lower);
}

/** Read sessions for a single project slug. */
export function readProject(
  projectSlug: string,
  opts: ReadOptions = {}
): ParsedSession[] {
  return readAllSessions(projectSlug, opts);
}

/** Enumerate distinct project slugs present in the scrape store. */
export function listProjects(): string[] {
  const out = new Set<string>();
  for (const source of SOURCES) {
    for (const file of listSourceFiles(source)) {
      const stem = basename(file.path, ".jsonl");
      out.add(deriveProjectSlug(source, stem));
    }
  }
  return [...out].sort();
}

/**
 * Reverse the Claude Code slug convention (separators → `-`) to produce a
 * best-effort label when no cwd is available.
 */
function prettifySlug(slug: string, source?: ScrapeSource): string {
  const homeSlug = homedir().replace(/[\\/:]/g, "-");
  if (slug === homeSlug) return "home";
  if (slug.startsWith(`${homeSlug}-dev-`)) return slug.slice(homeSlug.length + 5);
  if (slug.startsWith(`${homeSlug}-`)) return slug.slice(homeSlug.length + 1);
  if (source && slug === source) return source;
  return slug;
}

/**
 * Human-readable project label. Uses cwd as ground truth when available; falls
 * back to the slug (Claude Code) or the source name (Codex, which doesn't
 * carry per-session cwd in their scrape filenames).
 */
export function projectName(
  cwd: string | undefined,
  slug?: string,
  source?: ScrapeSource
): string {
  if (cwd && cwd.length > 0) {
    const norm = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
    const home = homedir().replace(/\\/g, "/").replace(/\/+$/, "");
    if (norm === home) return "home";
    const homePrefix = `${home}/`;
    if (norm.startsWith(homePrefix)) {
      const tail = norm.slice(homePrefix.length);
      if (tail.startsWith("dev/")) return tail.slice(4);
      const onedrive = "OneDrive/Desktop/";
      if (tail.toLowerCase().startsWith(onedrive.toLowerCase())) {
        return `desktop/${tail.slice(onedrive.length)}`;
      }
      return tail;
    }
    return norm;
  }
  if (slug) return prettifySlug(slug, source);
  return source ?? "unknown";
}

/** Get session stats across all sources. */
export function getSessionStats(): {
  projects: number;
  userSessions: number;
  sidechainSessions: number;
  totalSizeBytes: number;
  bySource: Record<ScrapeSource, { sessions: number; bytes: number }>;
} {
  const bySource: Record<ScrapeSource, { sessions: number; bytes: number }> = {
    "claude-code": { sessions: 0, bytes: 0 },
    codex: { sessions: 0, bytes: 0 },
  };
  const projects = new Set<string>();
  let total = 0;

  for (const source of SOURCES) {
    for (const file of listSourceFiles(source)) {
      bySource[source].sessions += 1;
      try {
        const size = statSync(file.path).size;
        bySource[source].bytes += size;
        total += size;
      } catch {
        // swallow — file vanished between listing and stat
      }
      const stem = basename(file.path, ".jsonl");
      projects.add(deriveProjectSlug(source, stem));
    }
  }

  const userSessions =
    bySource["claude-code"].sessions + bySource.codex.sessions;

  return {
    projects: projects.size,
    userSessions,
    sidechainSessions: 0,
    totalSizeBytes: total,
    bySource,
  };
}
