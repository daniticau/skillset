import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { CONFIG_FILE, DEFAULT_CODEX_SKILLS_DIR, STATE_FILE } from "./paths.js";
import type { ScrapeCursors } from "../ingest/sessions/types.js";
import type { SkillOrigin } from "./skill.js";

export type AgentKind = "claude-code" | "codex" | "copilot";

export interface Link {
  agent: AgentKind;
  path: string;
}

export interface Config {
  version: 1;
  links: Link[];
}

export interface ConflictRecord {
  /** ISO timestamp of when the conflict was resolved. */
  at: string;
  /** Adapter linkKey of the mirror whose edit won (most-recent mtime). */
  winnerAdapter: string;
  /** Number of mirrors whose edits were archived (one per non-winning divergence). */
  loserCount: number;
}

export type SkillCreatedBy = "deep-dive" | "nightly" | "make" | "cleanup" | "manual";

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

export type MineStage = "heuristic" | "llm-validated" | "embedded";

export interface ProcessedSession {
  fileHash: string;
  processedAt: string;
  stage: MineStage;
  /** Skill names (canonical) this session contributed evidence to, when known. */
  producedSkills?: string[];
}

export interface MineState {
  pipelineVersion: number;
  processedSessions: Record<string, ProcessedSession>;
  lastRunAt?: string;
}

export type MakeAction = "edit" | "create" | "skip";

export interface ProcessedCluster {
  action: MakeAction;
  targetSkill?: string;
  processedAt: string;
  reason?: string;
}

export interface MakeState {
  pipelineVersion: number;
  processedClusters: Record<string, ProcessedCluster>;
  lastRunAt?: string;
}

export interface UsageProcessedSession {
  fileHash: string;
  scannedAt: string;
}

export interface UsageState {
  processedSessions: Record<string, UsageProcessedSession>;
  lastScanAt?: string;
  /** Hash of canonical skill names at the last usage scan; changes trigger a rescan. */
  skillSetHash?: string;
}

export type CycleKind = "deep-dive" | "nightly" | "cleanup";

export type CheckpointStage =
  | "init"
  | "scraped"
  | "heuristic-done"
  | "llm-done"
  | "clusters-done"
  | "triaged"
  | "synthesized"
  | "committed"
  | "complete";

export interface CurrentCycle {
  id: string;
  kind: CycleKind;
  startedAt: string;
  stage: CheckpointStage;
  /** Optional free-form progress payload for resuming. */
  progress?: Record<string, unknown>;
}

export interface ReviewedDateRecord {
  status: "started" | "completed" | "skipped" | "failed";
  startedAt?: string;
  finishedAt?: string;
  cycleId?: string;
  cyclesRan: number;
  sessionsReviewed: number;
  mistakeClusters: number;
  preferenceClusters: number;
  skillsCreated: number;
  skillsEdited: number;
  skillsProduced: number;
  skillsMerged: number;
  skillsPruned: number;
  skipReason?: string;
}

export interface CycleDefaults {
  newCap: number;
  mistakeCap: number;
  preferenceCap: number;
  mergeCap: number;
  pruneCap: number;
  deepDiveCap: number;
}

export interface ScheduleConfig {
  /** e.g. "02:00-06:00" */
  window: string;
  idleCpuPct: number;
  idleInactivityMin: number;
}

export interface LlmPreferenceConfig {
  providerPreference: string[];
}

export interface CleanupConfig {
  /** v1 default false — prune candidates logged but not deleted until validated. */
  pruneEnabled: boolean;
}

export interface CycleConfig {
  cycleDefaults: CycleDefaults;
  schedule: ScheduleConfig;
  llm: LlmPreferenceConfig;
  cleanup: CleanupConfig;
}

export const DEFAULT_CYCLE_CONFIG: CycleConfig = {
  cycleDefaults: {
    newCap: 3,
    mistakeCap: 2,
    preferenceCap: 2,
    mergeCap: 3,
    pruneCap: 3,
    deepDiveCap: 10,
  },
  schedule: { window: "02:00-06:00", idleCpuPct: 30, idleInactivityMin: 5 },
  llm: { providerPreference: ["claude-cli", "anthropic", "codex-cli", "ollama"] },
  cleanup: { pruneEnabled: false },
};

export interface State {
  version: 2;
  skills: Record<string, SkillState>;
  scrape?: ScrapeCursors;
  mine?: MineState;
  make?: MakeState;
  usage?: UsageState;
  reviewedDates?: Record<string, ReviewedDateRecord>;
  currentCycle?: CurrentCycle;
  config?: CycleConfig;
}

const DEFAULT_CONFIG: Config = { version: 1, links: [] };
const DEFAULT_STATE: State = { version: 2, skills: {} };

function legacyCodexSkillsDir(): string {
  return join(homedir(), ".agents", "skills");
}

function normalizeConfig(config: Config): { config: Config; changed: boolean } {
  const codexHomeExists = existsSync(dirname(DEFAULT_CODEX_SKILLS_DIR));
  if (!codexHomeExists) return { config, changed: false };

  let changed = false;
  const links = config.links.map((link) => {
    if (link.agent !== "codex" || link.path !== legacyCodexSkillsDir()) {
      return link;
    }
    changed = true;
    return { ...link, path: DEFAULT_CODEX_SKILLS_DIR };
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

function migrateReviewedDates(raw: unknown): Record<string, ReviewedDateRecord> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, ReviewedDateRecord> = {};
  for (const [day, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const status =
      v.status === "started" ||
      v.status === "completed" ||
      v.status === "skipped" ||
      v.status === "failed"
        ? v.status
        : "completed";
    const num = (key: string) =>
      typeof v[key] === "number" && Number.isFinite(v[key]) ? v[key] as number : 0;
    const skillsCreated = num("skillsCreated") || num("skillsProduced");
    out[day] = {
      status,
      startedAt: typeof v.startedAt === "string" ? v.startedAt : undefined,
      finishedAt: typeof v.finishedAt === "string" ? v.finishedAt : undefined,
      cycleId: typeof v.cycleId === "string" ? v.cycleId : undefined,
      cyclesRan: num("cyclesRan"),
      sessionsReviewed: num("sessionsReviewed"),
      mistakeClusters: num("mistakeClusters"),
      preferenceClusters: num("preferenceClusters"),
      skillsCreated,
      skillsEdited: num("skillsEdited"),
      skillsProduced: num("skillsProduced") || skillsCreated,
      skillsMerged: num("skillsMerged"),
      skillsPruned: num("skillsPruned"),
      skipReason: typeof v.skipReason === "string" ? v.skipReason : undefined,
    };
  }
  return out;
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
    await readJson<Config>(CONFIG_FILE, DEFAULT_CONFIG)
  );
  if (changed) await writeJson(CONFIG_FILE, config);
  return config;
}

export async function writeConfig(config: Config): Promise<void> {
  await writeJson(CONFIG_FILE, normalizeConfig(config).config);
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
      v.createdBy === "manual"
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
    scrape: data.scrape as ScrapeCursors | undefined,
    mine: data.mine as MineState | undefined,
    make: data.make as MakeState | undefined,
    usage: data.usage as UsageState | undefined,
    reviewedDates: migrateReviewedDates(data.reviewedDates),
    currentCycle: data.currentCycle as CurrentCycle | undefined,
    config: data.config as CycleConfig | undefined,
  };
  void version;
  return base;
}

export async function readState(): Promise<State> {
  if (!existsSync(STATE_FILE)) return { ...DEFAULT_STATE, skills: {} };
  const raw = await readFile(STATE_FILE, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return migrateState(parsed);
}

export async function writeState(state: State): Promise<void> {
  await writeJson(STATE_FILE, state);
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
