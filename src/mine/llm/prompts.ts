/**
 * Prompt templates for LLM extraction and synthesis.
 * All prompts are pure functions — no I/O, no state.
 */

import type { NuggetCluster } from "../types.js";

export interface ConversationWindow {
  sessionId: string;
  project: string;
  messages: Array<{ role: "user" | "assistant"; text: string }>;
  startIndex: number;
  heuristicHits: string[];
}

const EXTRACTION_SYSTEM = `You extract personalization signals from developer conversations with an AI coding assistant. Given a conversation window, identify signals that describe how the user wants to work.

Signal categories:
- correction: user pushes back on something the assistant did ("don't do that", "revert", "I said...")
- preference: user states how they want things done ("always X", "I prefer Y", "from now on Z")
- rejection: user blocks or interrupts an assistant action
- workflow: user describes their process ("first I do X then Y", "before committing I always...")
- style: user states code style preferences (naming, formatting, tabs vs spaces, no any, etc)
- anti-pattern: something the user consistently avoids ("avoid X", "never Y", "don't ever Z")

Rules:
- Only extract from user messages, not assistant messages or tool results.
- Ignore pleasantries ("yes", "ok", "thanks", "looks good") — the user must be stating something substantive.
- Ignore one-off task descriptions ("fix the bug in auth.ts") — these are not personalization signals.
- Output valid JSON only. No prose, no code fences.
- Confidence in [0, 1]. 1.0 = explicit and unambiguous, 0.5 = hinted, <0.4 = skip.
- Rephrase signals as concise imperative statements, e.g. "Use pnpm instead of npm" not "I'd rather use pnpm".

Response format:
{"signals": [{"category": "<category>", "signal": "<concise imperative>", "confidence": <0-1>, "reasoning": "<optional brief why>"}]}

If no signals are present, return {"signals": []}.`;

const EXTRACTION_EXAMPLES = `Examples:

Input:
[A] I'll use try-catch to handle the error.
[U] Actually I prefer Result types, exceptions are too implicit.
[A] Switching to Result.

Output: {"signals": [{"category": "preference", "signal": "Use Result types instead of exceptions for error handling", "confidence": 0.9}]}

Input:
[U] don't use semicolons in TypeScript
[A] Got it, no semicolons.

Output: {"signals": [{"category": "style", "signal": "No semicolons in TypeScript", "confidence": 0.95}]}

Input:
[U] can you fix the login bug
[A] Looking at auth.ts now.
[U] thanks

Output: {"signals": []}

Input:
[A] I'll add a fallback for the missing config.
[U] stop adding fallbacks for things that can't happen. trust the code.

Output: {"signals": [{"category": "anti-pattern", "signal": "Do not add fallbacks or error handling for impossible scenarios", "confidence": 0.9}]}`;

export function extractionSystemPrompt(): string {
  return `${EXTRACTION_SYSTEM}\n\n${EXTRACTION_EXAMPLES}`;
}

export function extractionUserPrompt(window: ConversationWindow): string {
  const formatted = window.messages
    .map((m) => {
      const tag = m.role === "user" ? "[U]" : "[A]";
      const truncated = m.text.length > 600 ? m.text.slice(0, 600) + "…" : m.text;
      return `${tag} ${truncated}`;
    })
    .join("\n");

  const hits = window.heuristicHits.length > 0 ? `\n(heuristic flags: ${window.heuristicHits.join(", ")})` : "";
  return `Conversation window from project "${window.project}":${hits}\n\n${formatted}\n\nExtract signals as JSON:`;
}

const SYNTHESIS_SYSTEM = `You synthesize a user's personalization signals into a reusable SKILL.md file that a coding AI will read at the start of every session.

A SKILL.md file has:
1. YAML frontmatter with \`name\` (kebab-case) and \`description\` (one sentence describing when to apply)
2. Markdown body with clear instructions (imperative mood, under 400 words)

Rules:
- Be specific and actionable. "Use pnpm" not "The user has package manager preferences".
- Imperative mood: "Always...", "Never...", "When X, do Y".
- Group related signals into coherent sections.
- Include a "Do NOT" section for anti-patterns.
- The AI reading this file must be able to act on it directly without guessing.
- Output format: \`\`\`yaml frontmatter block, then markdown body. No commentary before or after.

The skill should be broadly applicable across projects unless the signals are project-specific.`;

export function synthesisSystemPrompt(): string {
  return SYNTHESIS_SYSTEM;
}

export function synthesisUserPrompt(cluster: NuggetCluster): string {
  const evidenceLines = cluster.members
    .slice(0, 8)
    .flatMap((n) => n.evidence.slice(0, 2))
    .slice(0, 10)
    .map((ev, i) => `  ${i + 1}. [${ev.project}] "${ev.userMessage.slice(0, 200)}"`)
    .join("\n");

  const categorySet = [...new Set(cluster.members.map((m) => m.category))].join(", ");
  const projects = cluster.projects.join(", ");

  return `A recurring signal cluster was mined from the user's coding sessions.

Categories: ${categorySet}
Projects where this appears: ${projects}
Occurrences: ${cluster.members.length}
Representative signal: "${cluster.canonical.signal}"

Evidence from sessions:
${evidenceLines}

Generate a SKILL.md file capturing this signal. The skill should be broadly applicable (not tied to one project) unless the evidence is clearly project-specific. Output the skill file content only.`;
}

/** Validation prompt: ask the LLM to confirm or reject a low-confidence heuristic nugget. */
export function validationPrompt(signal: string, category: string, context: string): string {
  return `Evaluate whether this is a genuine personalization signal from a developer.

Category claimed: ${category}
Signal: "${signal}"
Context: "${context.slice(0, 400)}"

Respond with JSON only:
{"valid": <bool>, "confidence": <0-1>, "refined_signal": "<rephrased imperative if valid, else empty>"}

A signal is valid if it describes a persistent preference, style, workflow, or correction that would apply across future tasks. It's invalid if it's a one-off task instruction, a question, or conversational filler.`;
}
