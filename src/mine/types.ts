/** Types for the mining pipeline. */

/** A single JSONL record from a Claude Code session. */
export interface SessionRecord {
  type: string;
  parentUuid?: string;
  uuid?: string;
  timestamp?: string;
  isSidechain?: boolean;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  slug?: string;
  version?: string;
  message?: {
    role: "user" | "assistant";
    content: string | ContentBlock[];
    model?: string;
  };
}

export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result" | "thinking";
  text?: string;
  thinking?: string;
  name?: string;
  input?: unknown;
  content?: string | ContentBlock[];
  tool_use_id?: string;
}

/** Metadata from sessions-index.json. */
export interface SessionIndexEntry {
  sessionId: string;
  fullPath: string;
  firstPrompt?: string;
  summary?: string;
  messageCount?: number;
  created?: string;
  modified?: string;
  gitBranch?: string;
  projectPath?: string;
}

/** A parsed session with its messages and metadata. */
export interface ParsedSession {
  sessionId: string;
  projectSlug: string;
  filePath: string;
  /** SHA-256 (first 16 hex chars) of the session file, computed at read time.
   *  Same value as sessionFileHash(filePath); avoids re-reading the file. */
  fileHash?: string;
  messages: SessionMessage[];
  metadata?: SessionIndexEntry;
  /** Absolute cwd of the session, read from the first record that has one.
   *  Authoritative for project naming; slug is lossy. */
  cwd?: string;
  /** Which agent produced this session (claude-code | codex). */
  source?: "claude-code" | "codex";
}

/** A flattened user or assistant message. */
export interface SessionMessage {
  role: "user" | "assistant";
  text: string;
  timestamp?: string;
  toolUses?: string[];
  isToolResult?: boolean;
  isRejection?: boolean;
}

/** A mined signal nugget. */
export interface Nugget {
  id: string;
  category: NuggetCategory;
  /** Main tailoring lane this signal belongs to. */
  focus?: NuggetFocus;
  signal: string;
  evidence: NuggetEvidence[];
  project?: string;
  confidence: number;
  /** Where this nugget came from — heuristic regex or LLM extraction. */
  source: "heuristic" | "llm";
  /** ISO timestamp when the nugget was created. */
  createdAt: string;
  /** Was this nugget validated (or created) by an LLM pass? */
  validatedByLLM?: boolean;
  /** Does this pattern appear across multiple projects? */
  crossProject?: boolean;
  /** Optional embedding vector (populated in dedup stage). */
  embedding?: number[];
  /** Number of times this signal was observed (for collapsed nuggets). */
  occurrences?: number;
}

export type NuggetCategory =
  | "correction"
  | "preference"
  | "rejection"
  | "workflow"
  | "tool-pattern"
  | "topic"
  | "style"
  | "anti-pattern";

export type NuggetFocus = "agent-mistake" | "user-preference" | "other";

export interface NuggetEvidence {
  sessionId: string;
  project: string;
  userMessage: string;
  context?: string;
  /** ISO timestamp of the evidence message. */
  timestamp?: string;
}

/** Summary stats from a mine run. */
export interface MineSummary {
  sessionsRead: number;
  messagesProcessed: number;
  nuggetsFound: number;
  byCategory: Record<NuggetCategory, number>;
  projects: string[];
}

/** JSON schema expected from LLM extraction calls. */
export interface LLMExtractionResult {
  signals: Array<{
    category: NuggetCategory;
    signal: string;
    confidence: number;
    reasoning?: string;
  }>;
}

/** A cluster of semantically similar nuggets. */
export interface NuggetCluster {
  id: string;
  canonical: Nugget;
  /** Primary tailoring lane for this cluster. */
  focus?: NuggetFocus;
  members: Nugget[];
  score: number;
  projects: string[];
}

export interface MinePipelineOptions {
  project?: string;
  llm?: boolean;
  verbose?: boolean;
  dryRun?: boolean;
  force?: boolean;
}
