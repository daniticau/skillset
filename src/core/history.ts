import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentKind } from "./config.js";
import { STORE_ROOT } from "./paths.js";
import { supportedAgents } from "./adapters/index.js";
import { commitStoreChange } from "./audit/git.js";

const HISTORY_FILE = join(STORE_ROOT, "history.jsonl");

export type HistoryKind =
  | "created"
  | "edited"
  | "deleted"
  | "activation"
  | "connection"
  | "schedule"
  | "promoted"
  | "adopted"
  | "conflict"
  | "undo";

export interface HistoryEvent {
  id: string;
  createdAt: string;
  kind: HistoryKind;
  title: string;
  detail: string;
  skillNames: string[];
  agents: AgentKind[];
  source: string;
}

export type NewHistoryEvent = Omit<HistoryEvent, "id" | "createdAt"> & {
  id?: string;
  createdAt?: string;
};

/** Every canonical skill is shared with every connected harness. */
export function sharedSkillAgents(): AgentKind[] {
  return supportedAgents();
}

export async function appendHistoryEvent(event: NewHistoryEvent): Promise<HistoryEvent> {
  const stored: HistoryEvent = {
    ...event,
    id: event.id ?? randomUUID(),
    createdAt: event.createdAt ?? new Date().toISOString(),
    skillNames: [...new Set(event.skillNames)],
    agents: [...new Set(event.agents)],
  };
  await mkdir(STORE_ROOT, { recursive: true });
  await appendFile(HISTORY_FILE, `${JSON.stringify(stored)}\n`, "utf8");

  // Every skill mutation flows through here, so this is the one place that can
  // keep the store's version history complete without each command remembering
  // to commit. No-ops when git is unavailable or nothing on disk changed.
  if (stored.kind === "created" || stored.kind === "edited" || stored.kind === "deleted") {
    await commitStoreChange(`${stored.kind}: ${stored.skillNames.join(", ") || stored.title}`);
  }

  return stored;
}

function isHistoryEvent(value: unknown): value is HistoryEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    typeof event.id === "string" &&
    typeof event.createdAt === "string" &&
    typeof event.kind === "string" &&
    typeof event.title === "string" &&
    typeof event.detail === "string" &&
    Array.isArray(event.skillNames) &&
    Array.isArray(event.agents) &&
    typeof event.source === "string"
  );
}

export async function readHistoryEvents(limit = 500): Promise<HistoryEvent[]> {
  if (!existsSync(HISTORY_FILE)) return [];
  const raw = await readFile(HISTORY_FILE, "utf8");
  const events: HistoryEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isHistoryEvent(parsed)) events.push(parsed);
    } catch {
      // Keep the rest of the append-only timeline usable if one line is damaged.
    }
  }
  return events
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}
