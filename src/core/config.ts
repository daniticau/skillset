import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { CONFIG_FILE, STATE_FILE } from "./paths.js";
import type { ScrapeCursors } from "../ingest/sessions/types.js";

export type AgentKind = "claude-code" | "cursor" | "codex" | "copilot";

export interface Link {
  agent: AgentKind;
  path: string;
}

export interface Config {
  version: 1;
  links: Link[];
}

export interface SkillState {
  canonicalHash: string;
  mirrorHashes: Record<string, string>;
  userModified: boolean;
}

export type MineStage = "heuristic" | "llm-validated" | "embedded";

export interface ProcessedSession {
  fileHash: string;
  processedAt: string;
  stage: MineStage;
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

export interface State {
  version: 1;
  skills: Record<string, SkillState>;
  scrape?: ScrapeCursors;
  mine?: MineState;
  make?: MakeState;
}

const DEFAULT_CONFIG: Config = { version: 1, links: [] };
const DEFAULT_STATE: State = { version: 1, skills: {} };

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
  return readJson<Config>(CONFIG_FILE, DEFAULT_CONFIG);
}

export async function writeConfig(config: Config): Promise<void> {
  await writeJson(CONFIG_FILE, config);
}

export async function readState(): Promise<State> {
  return readJson<State>(STATE_FILE, DEFAULT_STATE);
}

export async function writeState(state: State): Promise<void> {
  await writeJson(STATE_FILE, state);
}
