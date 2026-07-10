/**
 * Signal extractor — finds patterns in session messages using heuristics.
 * Produces categorized "nuggets" of signal: corrections, preferences,
 * rejections, workflows, tool patterns, style, anti-patterns.
 */

import { createHash } from "node:crypto";
import type {
  ParsedSession,
  SessionMessage,
  Nugget,
  NuggetCategory,
  NuggetEvidence,
  MineSummary,
} from "./types.js";
import { projectName } from "./reader.js";
import { focusForCategory } from "./focus.js";

/** Correction patterns — user pushing back on agent behavior. */
const CORRECTION_PATTERNS = [
  /\bdon'?t\s+(?:do|use|add|make|create|change|put|include|remove|delete)/i,
  /\bstop\s+(?:doing|adding|using|making|changing)/i,
  /\bno[,.]?\s+(?:that's|thats|not|I\s+(?:said|want|mean|need))/i,
  /\binstead[,]?\s+(?:use|do|try|make)/i,
  /\bthat'?s\s+(?:wrong|incorrect|not\s+(?:right|what|how))/i,
  /\bundo\s+that/i,
  /\brevert\s+(?:that|this|the)/i,
  /\bgo\s+back\b/i,
  /\bI\s+(?:said|asked|meant|wanted)\s+/i,
  /\bnot\s+what\s+I\s+(?:asked|wanted|meant)/i,
];

/** Preference patterns — user stating how they want things done. */
const PREFERENCE_PATTERNS = [
  /\balways\s+(?:use|do|make|keep|put|add|include|prefer)/i,
  /\bnever\s+(?:use|do|make|add|include|remove)/i,
  /\bI\s+prefer\s+/i,
  /\bI\s+(?:like|want)\s+(?:it|them|things)\s+(?:to\s+be|when)/i,
  /\buse\s+\w+\s+(?:instead\s+of|rather\s+than|not)\s+/i,
  /\bfrom\s+now\s+on\b/i,
  /\bgoing\s+forward\b/i,
  /\bremember\s+(?:to|that)\b/i,
];

/** Workflow patterns — user describing process or toolchain. */
const WORKFLOW_PATTERNS = [
  /\bfirst\s+\w+\s+then\b/i,
  /\bmy\s+(?:workflow|process|flow)\s+is\b/i,
  /\bI\s+(?:usually|typically|normally)\s+(?:start|begin|do|run)\b/i,
  /\bbefore\s+(?:committing|pushing|merging|deploying)\b/i,
  /\bafter\s+(?:every|each)\s+(?:change|commit|edit)\b/i,
];

/** Style patterns — code style preferences. */
const STYLE_PATTERNS = [
  /\b(?:use|prefer)\s+(?:tabs|spaces|semicolons|single\s+quotes|double\s+quotes)\b/i,
  /\b(?:camelCase|snake_case|kebab-case|PascalCase)\b/i,
  /\bno\s+(?:semicolons|trailing\s+whitespace|console\.log|any\b|wildcard\s+imports)/i,
  /\bstrict\s+(?:mode|typing|types)\b/i,
  /\bexplicit\s+(?:types|return\s+type|imports)\b/i,
];

/** Anti-pattern indicators — things user consistently avoids. */
const ANTI_PATTERN_PATTERNS = [
  /\bdon'?t\s+(?:ever|you\s+dare)\b/i,
  /\bavoid\s+(?:using|adding|creating|making)\b/i,
  /\bno\s+(?:mocking|magic|silent\s+fallbacks|speculative)\b/i,
];

/** Filter out common noise in message text. */
const NOISE_PATTERNS = [
  /^<command-name>/,
  /^<local-command/,
  /^\[Request interrupted/,
  /^\[System\]/,
  /^<system-reminder>/,
  /^<environment_context>/i,
  /^<recommended_plugins>/i,
  /^<INSTRUCTIONS>/i,
  /^# (?:AGENTS|CLAUDE)\.md instructions\b/i,
  /^Base directory for this skill:/i,
  /^You are Codex\b/i,
];

/** Minimum message length to consider for signal (filters out "ok", "yes", etc). */
const MIN_SIGNAL_LENGTH = 15;

/** Maximum signal length — avoid capturing giant prompts that happen to match a pattern. */
const MAX_SIGNAL_LENGTH = 800;

/** Maximum evidence entries per nugget. */
const MAX_EVIDENCE = 5;

function hashId(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

function matchPatterns(text: string, patterns: RegExp[]): RegExp | undefined {
  return patterns.find((p) => p.test(text));
}

function isNoise(text: string): boolean {
  return NOISE_PATTERNS.some((p) => p.test(text));
}

/** Compute a recency weight based on session timestamp. 14-day half-life —
 *  today = 1.0, 14d ago = 0.5, 30d = ~0.32, 60d ≈ 0.19. Recent behavior
 *  should dominate: the user's current habits matter more than last quarter's. */
function recencyWeight(timestamp: string | undefined, now: Date): number {
  if (!timestamp) return 0.5;
  const then = Date.parse(timestamp);
  if (Number.isNaN(then)) return 0.5;
  const daysSince = Math.max(0, (now.getTime() - then) / (1000 * 60 * 60 * 24));
  return 1 / (1 + daysSince / 14);
}

type PatternCategory =
  | "correction"
  | "preference"
  | "workflow"
  | "style"
  | "anti-pattern";

interface PatternExtractionSpec {
  category: PatternCategory;
  idPrefix: string;
  patterns: RegExp[];
  confidence: number;
  maxInputLength?: number;
  allowRejectionToolResults?: boolean;
  context?: (messages: SessionMessage[], index: number) => string | undefined;
}

function isEligibleUserSignal(
  message: SessionMessage,
  options: {
    allowRejectionToolResults?: boolean;
    maxInputLength?: number;
  } = {}
): boolean {
  if (message.role !== "user") return false;
  if (message.isToolResult && !(options.allowRejectionToolResults && message.isRejection)) {
    return false;
  }
  if (message.text.length < MIN_SIGNAL_LENGTH) return false;
  if (options.maxInputLength && message.text.length > options.maxInputLength) return false;
  return !isNoise(message.text);
}

function findPreviousAssistant(
  messages: SessionMessage[],
  startIndex: number
): SessionMessage | undefined {
  for (let i = startIndex - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role === "assistant" && message.text.length > 0) return message;
  }
  return undefined;
}

function buildHeuristicNugget(params: {
  category: PatternCategory;
  idPrefix: string;
  session: ParsedSession;
  project: string;
  signalText: string;
  confidence: number;
  timestamp?: string;
  context?: string;
}): Nugget {
  return {
    id: hashId(`${params.idPrefix}:${params.signalText.slice(0, 100)}`),
    category: params.category,
    focus: focusForCategory(params.category),
    signal: params.signalText,
    evidence: [
      {
        sessionId: params.session.sessionId,
        project: params.project,
        userMessage: params.signalText,
        context: params.context,
        timestamp: params.timestamp,
      },
    ],
    project: params.project,
    confidence: params.confidence,
    source: "heuristic",
    createdAt: new Date().toISOString(),
  };
}

function extractPatternSignals(
  session: ParsedSession,
  now: Date,
  spec: PatternExtractionSpec
): Nugget[] {
  const nuggets: Nugget[] = [];
  const project = projectName(session.cwd, session.projectSlug, session.source);

  for (let i = 0; i < session.messages.length; i++) {
    const message = session.messages[i]!;
    if (
      !isEligibleUserSignal(message, {
        allowRejectionToolResults: spec.allowRejectionToolResults,
        maxInputLength: spec.maxInputLength,
      })
    ) {
      continue;
    }
    if (!matchPatterns(message.text, spec.patterns)) continue;

    const signalText = message.text.slice(0, MAX_SIGNAL_LENGTH);
    const weight = recencyWeight(message.timestamp, now);

    nuggets.push(
      buildHeuristicNugget({
        category: spec.category,
        idPrefix: spec.idPrefix,
        session,
        project,
        signalText,
        confidence: spec.confidence * weight,
        timestamp: message.timestamp,
        context: spec.context?.(session.messages, i),
      })
    );
  }

  return nuggets;
}

/** Extract corrections from a session. */
function extractCorrections(session: ParsedSession, now: Date): Nugget[] {
  return extractPatternSignals(session, now, {
    category: "correction",
    idPrefix: "correction",
    patterns: CORRECTION_PATTERNS,
    confidence: 0.7,
    // Long product briefs often contain an incidental "don't add/use" clause
    // but are task specifications, not durable personalization signals.
    maxInputLength: MAX_SIGNAL_LENGTH,
    allowRejectionToolResults: true,
    context: (messages, index) => findPreviousAssistant(messages, index)?.text.slice(0, 200),
  });
}

/** Multi-turn correction arc: (assistant does X) → (user says stop/wrong) → (user clarifies). */
function extractMultiTurnCorrections(session: ParsedSession, now: Date): Nugget[] {
  const nuggets: Nugget[] = [];
  const project = projectName(session.cwd, session.projectSlug, session.source);
  const msgs = session.messages;

  for (let i = 1; i < msgs.length - 1; i++) {
    const prev = msgs[i - 1]!;
    const curr = msgs[i]!;
    const next = msgs[i + 1]!;

    if (prev.role !== "assistant") continue;
    if (curr.role !== "user") continue;
    if (curr.isToolResult) continue;
    if (curr.text.length < MIN_SIGNAL_LENGTH) continue;
    if (isNoise(curr.text)) continue;

    const rejectPattern = matchPatterns(curr.text, CORRECTION_PATTERNS);
    if (!rejectPattern) continue;

    // Look for a clarifying follow-up (user still talking or assistant acknowledging)
    const hasFollowUp =
      (next.role === "user" && !next.isToolResult && next.text.length > 10) ||
      (next.role === "assistant" && next.text.length > 10);
    if (!hasFollowUp) continue;

    const signalText = curr.text.slice(0, MAX_SIGNAL_LENGTH);
    const weight = recencyWeight(curr.timestamp, now);

    nuggets.push({
      id: hashId(`multiturn-correction:${signalText.slice(0, 100)}`),
      category: "correction",
      focus: focusForCategory("correction"),
      signal: signalText,
      evidence: [
        {
          sessionId: session.sessionId,
          project,
          userMessage: signalText,
          context: `[assistant did]: ${prev.text.slice(0, 150)}`,
          timestamp: curr.timestamp,
        },
      ],
      project,
      confidence: 0.85 * weight, // Higher confidence for multi-turn
      source: "heuristic",
      createdAt: new Date().toISOString(),
    });
  }

  return nuggets;
}

/** Extract preferences from a session. */
function extractPreferences(session: ParsedSession, now: Date): Nugget[] {
  return extractPatternSignals(session, now, {
    category: "preference",
    idPrefix: "preference",
    patterns: PREFERENCE_PATTERNS,
    confidence: 0.8,
    maxInputLength: MAX_SIGNAL_LENGTH,
  });
}

/** Extract workflow patterns. */
function extractWorkflows(session: ParsedSession, now: Date): Nugget[] {
  return extractPatternSignals(session, now, {
    category: "workflow",
    idPrefix: "workflow",
    patterns: WORKFLOW_PATTERNS,
    confidence: 0.65,
  });
}

/** Extract style preferences. */
function extractStyle(session: ParsedSession, now: Date): Nugget[] {
  return extractPatternSignals(session, now, {
    category: "style",
    idPrefix: "style",
    patterns: STYLE_PATTERNS,
    confidence: 0.75,
  });
}

/** Extract anti-patterns (things user consistently avoids). */
function extractAntiPatterns(session: ParsedSession, now: Date): Nugget[] {
  return extractPatternSignals(session, now, {
    category: "anti-pattern",
    idPrefix: "anti-pattern",
    patterns: ANTI_PATTERN_PATTERNS,
    confidence: 0.75,
  });
}

/** Extract raw tool-use rejections (pre-collapse). */
function extractRawRejections(session: ParsedSession, now: Date): Nugget[] {
  const nuggets: Nugget[] = [];
  const project = projectName(session.cwd, session.projectSlug, session.source);

  for (let i = 0; i < session.messages.length; i++) {
    const msg = session.messages[i]!;
    if (!msg.isRejection) continue;

    const prevAssistant = findPreviousAssistant(session.messages, i);

    // Skip rejections we can't attribute to a specific tool — they're just noise.
    if (!prevAssistant?.toolUses || prevAssistant.toolUses.length === 0) continue;

    const toolNames = prevAssistant.toolUses.join(", ");
    const weight = recencyWeight(msg.timestamp, now);

    nuggets.push({
      id: hashId(`rejection:${toolNames}`), // id by tool, so duplicates merge
      category: "rejection",
      focus: focusForCategory("rejection"),
      signal: `Rejected tool: ${toolNames}`,
      evidence: [
        {
          sessionId: session.sessionId,
          project,
          userMessage: msg.text.slice(0, 200) || `Rejected ${toolNames}`,
          context: prevAssistant?.text.slice(0, 200),
          timestamp: msg.timestamp,
        },
      ],
      project,
      confidence: 0.5 * weight,
      source: "heuristic",
      createdAt: new Date().toISOString(),
      occurrences: 1,
    });
  }

  return nuggets;
}

/**
 * Collapse duplicate rejections by tool name across sessions.
 * N rejections of `mcp__paper__get_selection` → 1 nugget with count=N.
 */
function collapseRejections(nuggets: Nugget[]): Nugget[] {
  const byId = new Map<string, Nugget>();

  for (const n of nuggets) {
    if (n.category !== "rejection") continue;
    const existing = byId.get(n.id);
    if (!existing) {
      byId.set(n.id, { ...n, occurrences: n.occurrences ?? 1 });
      continue;
    }
    existing.occurrences = (existing.occurrences ?? 1) + 1;
    // Merge evidence up to max
    for (const ev of n.evidence) {
      if (existing.evidence.length < MAX_EVIDENCE) {
        existing.evidence.push(ev);
      }
    }
    // Confidence grows with occurrences but caps
    existing.confidence = Math.min(0.9, existing.confidence + 0.02);
  }

  // Update signal text with count
  const collapsed: Nugget[] = [];
  for (const n of byId.values()) {
    const count = n.occurrences ?? 1;
    const toolName = n.signal.replace(/^Rejected tool: /, "");
    const projectsSet = new Set(n.evidence.map((e) => e.project));
    collapsed.push({
      ...n,
      signal:
        count > 1
          ? `Rejected tool "${toolName}" ${count} times across ${projectsSet.size} project(s)`
          : `Rejected tool "${toolName}"`,
      crossProject: projectsSet.size > 1,
    });
  }

  return collapsed;
}

/** Aggregate tool usage across sessions to find patterns. */
function extractToolPatterns(sessions: ParsedSession[]): Nugget[] {
  const toolCounts = new Map<string, { count: number; projects: Set<string> }>();

  for (const session of sessions) {
    const project = projectName(session.cwd, session.projectSlug, session.source);
    for (const msg of session.messages) {
      if (!msg.toolUses) continue;
      for (const tool of msg.toolUses) {
        const existing = toolCounts.get(tool) ?? { count: 0, projects: new Set() };
        existing.count += 1;
        existing.projects.add(project);
        toolCounts.set(tool, existing);
      }
    }
  }

  const nuggets: Nugget[] = [];
  const now = new Date().toISOString();

  for (const [tool, { count, projects }] of toolCounts) {
    if (projects.size < 2) continue;
    nuggets.push({
      id: hashId(`tool-pattern:${tool}`),
      category: "tool-pattern",
      focus: focusForCategory("tool-pattern"),
      signal: `Tool "${tool}" used ${count} times across ${projects.size} projects: ${[...projects].join(", ")}`,
      evidence: [],
      confidence: 0.5,
      source: "heuristic",
      createdAt: now,
      crossProject: projects.size > 1,
      occurrences: count,
    });
  }

  nuggets.sort((a, b) => (b.occurrences ?? 0) - (a.occurrences ?? 0));
  return nuggets.slice(0, 15);
}

/** Extract session topics from first prompts and index summaries. */
function extractTopics(sessions: ParsedSession[]): Nugget[] {
  const topics = new Map<
    string,
    { count: number; examples: NuggetEvidence[] }
  >();

  for (const session of sessions) {
    const project = projectName(session.cwd, session.projectSlug, session.source);
    const prompt = session.metadata?.firstPrompt ?? firstUserPrompt(session);
    const summary = session.metadata?.summary;

    if (!prompt && !summary) continue;

    const text = summary ?? prompt?.slice(0, 120) ?? "";
    if (text.length < 10) continue;
    if (isNoise(text)) continue;

    const existing = topics.get(project) ?? { count: 0, examples: [] };
    existing.count += 1;
    if (existing.examples.length < MAX_EVIDENCE) {
      existing.examples.push({
        sessionId: session.sessionId,
        project,
        userMessage: text.slice(0, 200),
      });
    }
    topics.set(project, existing);
  }

  const nuggets: Nugget[] = [];
  const now = new Date().toISOString();

  for (const [project, { count, examples }] of topics) {
    if (count < 2) continue;
    nuggets.push({
      id: hashId(`topic:${project}`),
      category: "topic",
      focus: focusForCategory("topic"),
      signal: `Project "${project}": ${count} sessions`,
      evidence: examples,
      project,
      confidence: 0.4,
      source: "heuristic",
      createdAt: now,
      occurrences: count,
    });
  }

  nuggets.sort((a, b) => (b.occurrences ?? 0) - (a.occurrences ?? 0));
  return nuggets;
}

function firstUserPrompt(session: ParsedSession): string | undefined {
  const msg = session.messages.find(
    (m) => m.role === "user" && !m.isToolResult && m.text.length > 10 && !isNoise(m.text)
  );
  return msg?.text;
}

/** Deduplicate nuggets by ID, merging evidence. */
function dedup(nuggets: Nugget[]): Nugget[] {
  const map = new Map<string, Nugget>();

  for (const n of nuggets) {
    const existing = map.get(n.id);
    if (existing) {
      for (const e of n.evidence) {
        if (existing.evidence.length < MAX_EVIDENCE) {
          existing.evidence.push(e);
        }
      }
      existing.confidence = Math.max(existing.confidence, n.confidence);
      existing.occurrences = (existing.occurrences ?? 1) + (n.occurrences ?? 1);
      // Mark crossProject if evidence spans multiple projects
      const projects = new Set(existing.evidence.map((e) => e.project));
      existing.crossProject = projects.size > 1;
    } else {
      map.set(n.id, { ...n });
    }
  }

  return [...map.values()];
}

const PER_SESSION_EXTRACTORS = [
  extractCorrections,
  extractMultiTurnCorrections,
  extractPreferences,
  extractWorkflows,
  extractStyle,
  extractAntiPatterns,
  extractRawRejections,
] as const;

/** Run full extraction pipeline on a set of sessions. */
export function extractSignal(
  sessions: ParsedSession[],
  options: { now?: Date } = {}
): {
  nuggets: Nugget[];
  summary: MineSummary;
} {
  const now = options.now ?? new Date();
  const allNuggets: Nugget[] = [];

  // Per-session extraction
  for (const session of sessions) {
    for (const extract of PER_SESSION_EXTRACTORS) {
      allNuggets.push(...extract(session, now));
    }
  }

  // Collapse rejections by tool name (before dedup — same IDs, different signals)
  const rejections = allNuggets.filter((n) => n.category === "rejection");
  const nonRejections = allNuggets.filter((n) => n.category !== "rejection");
  const collapsedRejections = collapseRejections(rejections);

  // Cross-session extraction
  const toolPatterns = extractToolPatterns(sessions);
  const topics = extractTopics(sessions);

  const merged = [...nonRejections, ...collapsedRejections, ...toolPatterns, ...topics];
  const nuggets = dedup(merged);

  // Sort: highest confidence first, then by category
  const categoryOrder: Record<NuggetCategory, number> = {
    correction: 0,
    preference: 1,
    style: 2,
    "anti-pattern": 3,
    workflow: 4,
    rejection: 5,
    "tool-pattern": 6,
    topic: 7,
  };
  nuggets.sort((a, b) => {
    const confDiff = b.confidence - a.confidence;
    if (Math.abs(confDiff) > 0.05) return confDiff;
    return (categoryOrder[a.category] ?? 9) - (categoryOrder[b.category] ?? 9);
  });

  // Build summary
  const byCategory = {} as Record<NuggetCategory, number>;
  for (const n of nuggets) {
    byCategory[n.category] = (byCategory[n.category] ?? 0) + 1;
  }

  const projects = [...new Set(sessions.map((s) => projectName(s.cwd, s.projectSlug, s.source)))];
  const messagesProcessed = sessions.reduce((acc, s) => acc + s.messages.length, 0);

  return {
    nuggets,
    summary: {
      sessionsRead: sessions.length,
      messagesProcessed,
      nuggetsFound: nuggets.length,
      byCategory,
      projects,
    },
  };
}

/** Export helpers for tests and other modules. */
export { collapseRejections, extractMultiTurnCorrections, recencyWeight };
