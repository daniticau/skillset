import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import * as paths from "./paths.js";
import type { SkillOrigin } from "./skill.js";

export type AgentKind = "claude-code" | "codex" | "kimi-code" | "grok" | "cursor";

export interface Link {
  agent: AgentKind;
  path: string;
}

export interface Config {
  version: 1;
  links: Link[];
  /**
   * Skill names skillset must never adopt from a mirror.
   *
   * Agents ship and install their own skills into the same directories that
   * skillset mirrors into. Without this, anything a vendor or third-party
   * installer drops into one agent's skills dir gets adopted into the shared
   * library and broadcast to every other agent. Ignored names stay where they
   * are — untouched and un-propagated.
   */
  ignore?: string[];
}

export interface ConflictRecord {
  /** ISO timestamp of when the conflict was resolved. */
  at: string;
  /** Adapter linkKey of the mirror whose edit won (most-recent mtime). */
  winnerAdapter: string;
  /** Number of mirrors whose edits were archived (one per non-winning divergence). */
  loserCount: number;
}

export type SkillCreatedBy = "manual" | "agent";

export interface SkillState {
  canonicalHash: string;
  mirrorHashes: Record<string, string>;
  /** True once any user edit (direct or promoted-from-mirror) has touched this skill. */
  userEdited: boolean;
  /** Authorship. Legacy (v1) entries migrate to "user-created" conservatively. */
  origin: SkillOrigin;
  /** Which pipeline produced this skill. Undefined for origin=user-created. */
  createdBy?: SkillCreatedBy;
  /** ISO timestamp of first canonical write. */
  createdAt: string;
  /** ISO timestamp of most recent edit (auto or user). Undefined until first edit. */
  lastEditedAt?: string;
  /** Audit pointer to archive dir when cleanup retired this skill. */
  lostInCleanup?: { at: string; archivePath: string };
  /** Append-only log of multi-mirror conflict resolutions for this skill. */
  conflictHistory?: ConflictRecord[];
}

export interface State {
  version: 2;
  skills: Record<string, SkillState>;
}

const DEFAULT_CONFIG: Config = { version: 1, links: [] };
const DEFAULT_STATE: State = { version: 2, skills: {} };

function legacyCodexSkillsDir(): string {
  return paths.LEGACY_CODEX_SKILLS_DIR ?? join(dirname(paths.DEFAULT_CODEX_SKILLS_DIR), "..", ".agents", "skills");
}

function normalizeConfig(config: Config): { config: Config; changed: boolean } {
  const codexHomeExists = existsSync(dirname(paths.DEFAULT_CODEX_SKILLS_DIR));

  let changed = false;
  const legacyCodexPath = legacyCodexSkillsDir();
  const links = config.links.map((link) => {
    if (codexHomeExists && link.agent === "codex" && link.path === legacyCodexPath) {
      changed = true;
      return { ...link, path: paths.DEFAULT_CODEX_SKILLS_DIR };
    }
    return link;
  });

  const seen = new Set<string>();
  const deduped = links.filter((link) => {
    const key = `${link.agent}:${link.path}`;
    if (seen.has(key)) {
      changed = true;
      return false;
    }
    seen.add(key);
    return true;
  });

  return {
    config: changed ? { ...config, links: deduped } : config,
    changed,
  };
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  if (!existsSync(path)) return fallback;
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export async function readConfig(): Promise<Config> {
  const { config, changed } = normalizeConfig(
    await readJson<Config>(paths.CONFIG_FILE, DEFAULT_CONFIG)
  );
  if (changed) await writeJson(paths.CONFIG_FILE, config);
  return config;
}

export async function writeConfig(config: Config): Promise<void> {
  await writeJson(paths.CONFIG_FILE, normalizeConfig(config).config);
}

/**
 * Migrate a raw state object forward to the latest version. Cheap & idempotent:
 *   - v1: upgrade each SkillState to v2 shape (userModified → userEdited, fill origin+createdAt).
 *   - v2: return as-is but sanity-default missing optional fields.
 *
 * Missing origin on legacy skills is resolved CONSERVATIVELY to "user-created" — we can't
 * retroactively know who authored them, and the user-created lock is the safer default.
 */
export function migrateState(raw: unknown): State {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_STATE };
  const data = raw as Record<string, unknown>;
  const version = typeof data.version === "number" ? data.version : 1;
  const now = new Date().toISOString();

  const rawSkills = (data.skills as Record<string, unknown> | undefined) ?? {};
  const skills: Record<string, SkillState> = {};
  for (const [name, value] of Object.entries(rawSkills)) {
    if (!value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const origin = (v.origin === "auto-created" || v.origin === "user-created")
      ? (v.origin as SkillOrigin)
      : "user-created";
    const userEdited =
      typeof v.userEdited === "boolean"
        ? v.userEdited
        : typeof v.userModified === "boolean"
          ? v.userModified
          : false;
    const createdBy =
      v.createdBy === "deep-dive" ||
      v.createdBy === "nightly" ||
      v.createdBy === "make" ||
      v.createdBy === "cleanup" ||
      v.createdBy === "manual" ||
      v.createdBy === "agent"
        ? (v.createdBy as SkillCreatedBy)
        : undefined;
    skills[name] = {
      canonicalHash: typeof v.canonicalHash === "string" ? v.canonicalHash : "",
      mirrorHashes:
        (v.mirrorHashes as Record<string, string> | undefined) ?? {},
      userEdited,
      origin,
      createdBy,
      createdAt: typeof v.createdAt === "string" ? v.createdAt : now,
      lastEditedAt: typeof v.lastEditedAt === "string" ? v.lastEditedAt : undefined,
      lostInCleanup: v.lostInCleanup as SkillState["lostInCleanup"],
      conflictHistory: v.conflictHistory as ConflictRecord[] | undefined,
    };
  }

  const base: State = {
    version: 2,
    skills,
  };
  void version;
  return base;
}

export async function readState(): Promise<State> {
  if (!existsSync(paths.STATE_FILE)) return { ...DEFAULT_STATE, skills: {} };
  const raw = await readFile(paths.STATE_FILE, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return migrateState(parsed);
}

export async function writeState(state: State): Promise<void> {
  await writeJson(paths.STATE_FILE, state);
}

/**
 * Create a fresh SkillState record. `origin` is required — callers must decide
 * authorship at creation time. `createdAt` defaults to now unless overridden (tests).
 */
export function initialSkillState(
  origin: SkillOrigin,
  extras: Partial<SkillState> = {}
): SkillState {
  return {
    canonicalHash: "",
    mirrorHashes: {},
    userEdited: false,
    origin,
    createdAt: new Date().toISOString(),
    ...extras,
  };
}
