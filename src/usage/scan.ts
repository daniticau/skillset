import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import type { ScrapeEnvelope, ScrapeSource } from "../ingest/sessions/types.js";
import { parseJsonLinesLenient } from "../ingest/sessions/jsonl.js";
import { listStoreSkills } from "../core/store.js";
import { readState, writeState } from "../core/config.js";
import type { UsageState } from "../core/config.js";
import { readAllSessions, projectName } from "../mine/reader.js";
import type { ParsedSession, SessionMessage } from "../mine/types.js";
import { sessionFileHash } from "../mine/state.js";
import {
  appendUsageEvents,
  createInferredUsageEvent,
} from "./events.js";
import type { SkillUsageEvent } from "./events.js";

export interface UsageScanOptions {
  project?: string;
  force?: boolean;
}

export interface UsageScanReport {
  scanned: number;
  skipped: number;
  inferred: number;
  added: number;
  knownSkills: number;
  skillSetChanged: boolean;
}

interface KnownSkills {
  names: Set<string>;
  lowerToName: Map<string, string>;
}

function knownSkills(names: string[]): KnownSkills {
  return {
    names: new Set(names),
    lowerToName: new Map(names.map((name) => [name.toLowerCase(), name])),
  };
}

function skillSetHash(names: string[]): string {
  return createHash("sha256")
    .update(JSON.stringify([...names].sort()))
    .digest("hex")
    .slice(0, 24);
}

function resolveKnownSkill(raw: unknown, known: KnownSkills): string | undefined {
  if (typeof raw !== "string") return undefined;
  const cleaned = raw.trim().replace(/^["'`]+|["'`]+$/g, "");
  return known.names.has(cleaned) ? cleaned : known.lowerToName.get(cleaned.toLowerCase());
}

function timestampFromRaw(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  return typeof r.timestamp === "string" ? r.timestamp : undefined;
}

function fallbackUsedAt(
  env: ScrapeEnvelope | undefined,
  session: ParsedSession
): string {
  if (env?.scrapedAt) return env.scrapedAt;
  for (const message of session.messages) {
    if (message.timestamp) return message.timestamp;
  }
  try {
    return new Date(statSync(session.filePath).mtimeMs).toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

function parseMaybeJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function candidateStrings(value: unknown, out: string[] = []): string[] {
  const parsed = parseMaybeJson(value);
  if (typeof parsed === "string") {
    out.push(parsed);
    return out;
  }
  if (!parsed || typeof parsed !== "object") return out;
  if (Array.isArray(parsed)) {
    for (const item of parsed) candidateStrings(item, out);
    return out;
  }
  const obj = parsed as Record<string, unknown>;
  for (const key of ["skill", "skillName", "skill_name", "name", "id"]) {
    candidateStrings(obj[key], out);
  }
  return out;
}

function looksLikeSkillTool(obj: Record<string, unknown>): boolean {
  const name = typeof obj.name === "string" ? obj.name : "";
  const type = typeof obj.type === "string" ? obj.type : "";
  return /\bskills?\b/i.test(name) || /\bskills?\b/i.test(type);
}

function collectNativeSkillUses(
  value: unknown,
  known: KnownSkills,
  out = new Set<string>()
): Set<string> {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const item of value) collectNativeSkillUses(item, known, out);
    return out;
  }

  const obj = value as Record<string, unknown>;
  if (looksLikeSkillTool(obj)) {
    const candidates = [
      ...candidateStrings(obj.input),
      ...candidateStrings(obj.arguments),
      ...candidateStrings(obj.payload),
      ...candidateStrings(obj),
    ];
    for (const candidate of candidates) {
      const skill = resolveKnownSkill(candidate, known);
      if (skill) out.add(skill);
    }
  }

  for (const child of Object.values(obj)) {
    collectNativeSkillUses(child, known, out);
  }
  return out;
}

function skillFileReadText(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const payload =
    record.payload && typeof record.payload === "object"
      ? (record.payload as Record<string, unknown>)
      : undefined;

  if (record.type === "response_item" && payload) {
    if (payload.type === "function_call" || payload.type === "tool_call") {
      const name = typeof payload.name === "string" ? payload.name : "";
      if (!/\b(exec_command|read|open)\b/i.test(name)) return undefined;
      return JSON.stringify(payload.arguments ?? payload.input ?? payload);
    }
    return undefined;
  }

  if (record.type === "event_msg" && payload?.type === "exec_command_end") {
    return JSON.stringify({
      command: payload.command,
      parsed_cmd: payload.parsed_cmd,
    });
  }

  if (record.type === "function_call" || record.type === "tool_call") {
    const name = typeof record.name === "string" ? record.name : "";
    if (!/\b(exec_command|read|open)\b/i.test(name)) return undefined;
    return JSON.stringify(record.arguments ?? record.input ?? record);
  }

  return undefined;
}

function collectSkillFileReads(raw: unknown, known: KnownSkills): Set<string> {
  const text = skillFileReadText(raw);
  const skills = new Set<string>();
  if (!text) return skills;
  for (const name of known.names) {
    const escaped = escapeRegex(name);
    const re = new RegExp(`(?:^|[/\\\\])${escaped}[/\\\\]SKILL\\.md\\b`, "i");
    if (re.test(text)) skills.add(name);
  }
  return skills;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function announcementUses(message: SessionMessage, known: KnownSkills): string[] {
  if (message.role !== "assistant" || !message.text) return [];
  const uses: string[] = [];
  for (const name of known.names) {
    const escaped = escapeRegex(name);
    const re = new RegExp(
      `\\b(?:i(?:'m| am)?\\s+)?(?:using|loading|loaded|activating|activated|invoking)\\s+(?:the\\s+)?["'\`]?${escaped}["'\`]?\\s+skill\\b`,
      "i"
    );
    if (re.test(message.text)) uses.push(name);
  }
  return uses;
}

function readEnvelopes(path: string): ScrapeEnvelope[] {
  try {
    return parseJsonLinesLenient<ScrapeEnvelope>(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
}

function dedupeSessionEvents(events: SkillUsageEvent[]): SkillUsageEvent[] {
  const best = new Map<string, SkillUsageEvent>();
  for (const event of events) {
    const key = event.skillName;
    const current = best.get(key);
    if (
      !current ||
      event.confidence > current.confidence ||
      (event.confidence === current.confidence && event.usedAt > current.usedAt)
    ) {
      best.set(key, event);
    }
  }
  return [...best.values()].sort((a, b) => a.usedAt.localeCompare(b.usedAt));
}

export function inferUsageFromSession(
  session: ParsedSession,
  skillNames: string[]
): SkillUsageEvent[] {
  const known = knownSkills(skillNames);
  if (known.names.size === 0) return [];

  const project = projectName(session.cwd, session.projectSlug, session.source);
  const agent = session.source ?? "unknown";
  const events: SkillUsageEvent[] = [];
  const envelopes = readEnvelopes(session.filePath);

  for (const env of envelopes) {
    const skills = collectNativeSkillUses(env.raw, known);
    for (const skillName of skills) {
      events.push(
        createInferredUsageEvent({
          skillName,
          agent: env.source ?? agent,
          usedAt: timestampFromRaw(env.raw) ?? fallbackUsedAt(env, session),
          confidence: 0.95,
          sessionId: env.sessionId ?? session.sessionId,
          project,
          evidence: "native skill invocation",
        })
      );
    }

    const skillFileReads = collectSkillFileReads(env.raw, known);
    for (const skillName of skillFileReads) {
      events.push(
        createInferredUsageEvent({
          skillName,
          agent: env.source ?? agent,
          usedAt: timestampFromRaw(env.raw) ?? fallbackUsedAt(env, session),
          confidence: 0.85,
          sessionId: env.sessionId ?? session.sessionId,
          project,
          evidence: "skill file read",
        })
      );
    }
  }

  const fallbackEnv = envelopes[0];
  for (const message of session.messages) {
    for (const skillName of announcementUses(message, known)) {
      events.push(
        createInferredUsageEvent({
          skillName,
          agent,
          usedAt: message.timestamp ?? fallbackUsedAt(fallbackEnv, session),
          confidence: 0.7,
          sessionId: session.sessionId,
          project,
          evidence: message.text.slice(0, 240),
        })
      );
    }
  }

  return dedupeSessionEvents(events);
}

function emptyUsageState(): UsageState {
  return { processedSessions: {} };
}

function sessionKey(session: Pick<ParsedSession, "source" | "sessionId">): string {
  return `${session.source ?? "unknown"}:${session.sessionId}`;
}

export async function scanUsageFromSessions(
  options: UsageScanOptions = {}
): Promise<UsageScanReport> {
  const skillNames = await listStoreSkills();
  const currentSkillSetHash = skillSetHash(skillNames);
  const sessions = readAllSessions(options.project);
  const state = await readState();
  const usage = state.usage ?? emptyUsageState();
  const skillSetChanged = usage.skillSetHash !== currentSkillSetHash;
  const updates: UsageState["processedSessions"] = {};
  const inferredEvents: SkillUsageEvent[] = [];
  let scanned = 0;
  let skipped = 0;

  for (const session of sessions) {
    const hash = sessionFileHash(session.filePath);
    const key = sessionKey(session);
    if (
      !options.force &&
      !skillSetChanged &&
      hash &&
      usage.processedSessions[key]?.fileHash === hash
    ) {
      skipped += 1;
      continue;
    }
    scanned += 1;
    inferredEvents.push(...inferUsageFromSession(session, skillNames));
    updates[key] = { fileHash: hash, scannedAt: new Date().toISOString() };
  }

  const append = await appendUsageEvents(inferredEvents);
  const latest = await readState();
  latest.usage = {
    ...(latest.usage ?? emptyUsageState()),
    processedSessions: {
      ...((latest.usage ?? usage).processedSessions ?? {}),
      ...updates,
    },
    lastScanAt: new Date().toISOString(),
    skillSetHash: currentSkillSetHash,
  };
  await writeState(latest);

  return {
    scanned,
    skipped,
    inferred: inferredEvents.length,
    added: append.added,
    knownSkills: skillNames.length,
    skillSetChanged,
  };
}

export type { ScrapeSource };
