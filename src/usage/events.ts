import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { USAGE_EVENTS_FILE } from "../core/paths.js";

export type UsageEventSource = "inferred" | "explicit";

export interface SkillUsageEvent {
  id: string;
  skillName: string;
  agent: string;
  usedAt: string;
  source: UsageEventSource;
  confidence: number;
  sessionId?: string;
  project?: string;
  evidence?: string;
}

export interface UsageAppendResult {
  added: number;
  skipped: number;
}

export interface UsageSummary {
  skillName: string;
  count: number;
  explicitCount: number;
  inferredCount: number;
  lastUsedAt?: string;
  lastAgent?: string;
}

function hashId(parts: unknown[]): string {
  return createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 24);
}

function usageId(prefix: UsageEventSource, parts: unknown[]): string {
  return `${prefix}-${hashId(parts)}`;
}

function isValidEvent(raw: unknown): raw is SkillUsageEvent {
  if (!raw || typeof raw !== "object") return false;
  const e = raw as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.skillName === "string" &&
    typeof e.agent === "string" &&
    typeof e.usedAt === "string" &&
    (e.source === "inferred" || e.source === "explicit") &&
    typeof e.confidence === "number"
  );
}

export function createExplicitUsageEvent(input: {
  skillName: string;
  agent?: string;
  usedAt?: string;
  project?: string;
  evidence?: string;
}): SkillUsageEvent {
  const skillName = input.skillName.trim();
  const agent = input.agent?.trim() || "manual";
  const usedAt = input.usedAt ?? new Date().toISOString();
  return {
    id: usageId("explicit", [
      skillName,
      agent,
      usedAt,
      input.project ?? "",
      input.evidence ?? "",
    ]),
    skillName,
    agent,
    usedAt,
    source: "explicit",
    confidence: 1,
    ...(input.project ? { project: input.project } : {}),
    ...(input.evidence ? { evidence: input.evidence } : {}),
  };
}

export function createInferredUsageEvent(input: {
  skillName: string;
  agent: string;
  usedAt: string;
  confidence: number;
  sessionId?: string;
  project?: string;
  evidence?: string;
}): SkillUsageEvent {
  return {
    id: usageId("inferred", [
      input.skillName,
      input.agent,
      input.usedAt,
      input.sessionId ?? "",
      input.project ?? "",
      input.evidence ?? "",
    ]),
    skillName: input.skillName,
    agent: input.agent,
    usedAt: input.usedAt,
    source: "inferred",
    confidence: input.confidence,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.project ? { project: input.project } : {}),
    ...(input.evidence ? { evidence: input.evidence } : {}),
  };
}

export async function readUsageEvents(): Promise<SkillUsageEvent[]> {
  if (!existsSync(USAGE_EVENTS_FILE)) return [];
  const raw = await readFile(USAGE_EVENTS_FILE, "utf8");
  const events: SkillUsageEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isValidEvent(parsed)) events.push(parsed);
    } catch {
      // Keep the reader forgiving; one bad line should not hide all telemetry.
    }
  }
  return events;
}

export async function appendUsageEvents(
  events: SkillUsageEvent[]
): Promise<UsageAppendResult> {
  if (events.length === 0) return { added: 0, skipped: 0 };
  await mkdir(dirname(USAGE_EVENTS_FILE), { recursive: true });
  const existingIds = new Set((await readUsageEvents()).map((e) => e.id));
  const seenIncoming = new Set<string>();
  const lines: string[] = [];
  let skipped = 0;

  for (const event of events) {
    if (existingIds.has(event.id) || seenIncoming.has(event.id)) {
      skipped += 1;
      continue;
    }
    seenIncoming.add(event.id);
    lines.push(JSON.stringify(event));
  }

  if (lines.length > 0) {
    await appendFile(USAGE_EVENTS_FILE, lines.join("\n") + "\n", "utf8");
  }
  return { added: lines.length, skipped };
}

export function summarizeUsage(
  events: SkillUsageEvent[]
): Map<string, UsageSummary> {
  const summaries = new Map<string, UsageSummary>();
  for (const event of events) {
    const current =
      summaries.get(event.skillName) ??
      ({
        skillName: event.skillName,
        count: 0,
        explicitCount: 0,
        inferredCount: 0,
      } satisfies UsageSummary);
    current.count += 1;
    if (event.source === "explicit") current.explicitCount += 1;
    else current.inferredCount += 1;
    if (!current.lastUsedAt || event.usedAt > current.lastUsedAt) {
      current.lastUsedAt = event.usedAt;
      current.lastAgent = event.agent;
    }
    summaries.set(event.skillName, current);
  }
  return summaries;
}
