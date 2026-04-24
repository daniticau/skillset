import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { STORE_ROOT } from "../core/paths.js";
import type { Nugget, NuggetCluster } from "./types.js";

const NUGGETS_DIR = join(STORE_ROOT, "nuggets");

export const NUGGETS_FILE = join(NUGGETS_DIR, "nuggets.json");
export const CLUSTERS_FILE = join(NUGGETS_DIR, "clusters.json");

async function writeJsonArtifact(path: string, data: unknown): Promise<void> {
  await mkdir(NUGGETS_DIR, { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

async function readJsonArtifact<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

function normalizeNugget(nugget: Nugget): Nugget {
  return {
    ...nugget,
    source: nugget.source ?? "heuristic",
    createdAt: nugget.createdAt ?? new Date().toISOString(),
  };
}

export async function saveNuggets(nuggets: Nugget[]): Promise<void> {
  await writeJsonArtifact(NUGGETS_FILE, nuggets);
}

export async function saveClusters(clusters: NuggetCluster[]): Promise<void> {
  await writeJsonArtifact(CLUSTERS_FILE, clusters);
}

/**
 * Forgiving reader used by long-running pipelines. Missing or malformed data
 * should not explode the whole cycle — callers can rebuild artifacts.
 */
export async function loadNuggets(): Promise<Nugget[]> {
  if (!existsSync(NUGGETS_FILE)) return [];
  try {
    const nuggets = await readJsonArtifact<Nugget[]>(NUGGETS_FILE);
    return nuggets.map(normalizeNugget);
  } catch {
    return [];
  }
}

/**
 * Forgiving reader used by long-running pipelines. Commands that need to
 * surface parse errors should call `readClusters()` directly.
 */
export async function loadClusters(): Promise<NuggetCluster[]> {
  if (!existsSync(CLUSTERS_FILE)) return [];
  try {
    return await readClusters();
  } catch {
    return [];
  }
}

export async function readClusters(): Promise<NuggetCluster[]> {
  return readJsonArtifact<NuggetCluster[]>(CLUSTERS_FILE);
}
