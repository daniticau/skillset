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

const TIER_DEFINITIONS = `Tier definitions (used in YAML frontmatter \`tier\` field):
- high: narrow style/typography rules, single-fact corrections, anything where being wrong has trivial cost (e.g. "no em-dashes", "use pnpm not npm"). Auto-installed silently.
- medium: workflow preferences, tool-routing rules, anti-patterns at a single tool/library level (e.g. "before X, run Y", "don't mock the database in tests"). Auto-installed with a notice.
- low: broad behavior changes that affect how the AI reasons about a class of problems (e.g. "always start with TDD", "decompose long tasks into sub-agents"). Held as a draft for human review.

When in doubt between two tiers, choose the lower (more conservative) one.`;

const SYNTHESIS_SYSTEM = `You synthesize a user's personalization signals into a reusable SKILL.md file that a coding AI will read at the start of every session.

A SKILL.md file has:
1. YAML frontmatter with \`name\` (kebab-case), \`description\` (one sentence describing when to apply), and \`tier\` (high|medium|low)
2. Markdown body with clear instructions (imperative mood, under 400 words)

${TIER_DEFINITIONS}

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

/**
 * Triage prompt: given an observed cluster, decide whether to EDIT an existing
 * skill, CREATE a new one, or SKIP. The existing skill list goes in the system
 * prompt so Anthropic prompt caching can amortize it across all clusters in a
 * single `sks make` run.
 */
export function triageSystemPrompt(
  existingSkills: Array<{ name: string; description: string }>
): string {
  const listing =
    existingSkills.length === 0
      ? "(no existing skills yet)"
      : existingSkills.map((s) => `- ${s.name}: ${s.description}`).join("\n");

  return [
    "You review patterns from a user's recent AI-agent interaction history and decide whether to update or add a skill.",
    "",
    'A "skill" is a SKILL.md file the AI reads at the start of future sessions — a compact set of durable rules about how the user wants to work.',
    "",
    `Existing skills (${existingSkills.length}):`,
    listing,
    "",
    "Given a single detected pattern, decide exactly one action:",
    "  1. EDIT — the pattern overlaps an existing skill's scope; that skill should absorb this evidence.",
    "  2. CREATE — the pattern is distinct from every existing skill AND actionable enough to justify a new file.",
    "  3. SKIP — the pattern is noise, too narrow, not actionable, or the evidence is thin.",
    "",
    TIER_DEFINITIONS,
    "",
    "Rules:",
    "- Prefer EDIT over CREATE. New skills compound clutter. If any existing skill meaningfully overlaps, choose EDIT.",
    "- If budget remaining is 0, never CREATE — SKIP with reason \"budget exceeded\".",
    "- Every EDIT and CREATE must include a `tier` field (high|medium|low).",
    "- Only return one action.",
    "- Output strict JSON. No prose, no code fences.",
    "",
    "JSON shapes:",
    '  {"kind":"edit","targetName":"<existing skill name>","tier":"<high|medium|low>","rationale":"..."}',
    '  {"kind":"create","name":"<kebab-case>","description":"<one sentence>","tier":"<high|medium|low>","rationale":"..."}',
    '  {"kind":"skip","reason":"..."}',
  ].join("\n");
}

export function triageUserPrompt(cluster: NuggetCluster, budgetRemaining: number): string {
  const evidence = cluster.members
    .slice(0, 5)
    .flatMap((n) => n.evidence.slice(0, 1))
    .slice(0, 5)
    .map((ev, i) => `  ${i + 1}. [${ev.project}] "${ev.userMessage.slice(0, 180).replace(/"/g, "'")}"`)
    .join("\n");

  return [
    "Observed pattern:",
    `  category: ${cluster.canonical.category}`,
    `  signal: "${cluster.canonical.signal.slice(0, 300).replace(/"/g, "'")}"`,
    `  occurrences: ${cluster.members.length}`,
    `  projects: ${cluster.projects.join(", ") || "(none)"}`,
    "  evidence:",
    evidence || "  (no evidence samples)",
    "",
    `Budget remaining for new skills this run: ${budgetRemaining}`,
    "",
    "Return JSON only.",
  ].join("\n");
}

/** Rewrite an existing SKILL.md to incorporate new evidence from a cluster. */
export function editRewriteSystemPrompt(): string {
  return [
    "You update an existing SKILL.md file to incorporate newly observed user behavior.",
    "",
    "Preserve the existing structure and tone. Only add or adjust rules the new evidence supports.",
    "Don't bloat the file — a crisp skill beats a comprehensive one.",
    "Keep the YAML `name` field exactly as-is. You may refine the `description` if the new evidence warrants it.",
    "",
    TIER_DEFINITIONS,
    "",
    "If the existing frontmatter has a `tier` field, preserve it unless the new evidence clearly justifies an UPGRADE (low → medium → high). Never downgrade tier.",
    "If the existing skill has no `tier`, leave it absent unless you're confident — most legacy skills should remain untiered.",
    "",
    "Output format: complete SKILL.md with YAML frontmatter followed by the markdown body. No commentary before or after. No code fences.",
  ].join("\n");
}

export function editRewriteUserPrompt(currentSkill: string, cluster: NuggetCluster): string {
  const evidence = cluster.members
    .slice(0, 6)
    .flatMap((n) => n.evidence.slice(0, 1))
    .slice(0, 6)
    .map((ev, i) => `  ${i + 1}. [${ev.project}] "${ev.userMessage.slice(0, 200).replace(/"/g, "'")}"`)
    .join("\n");

  return [
    "Current SKILL.md:",
    "---8<---",
    currentSkill,
    "---8<---",
    "",
    "New observed pattern (to incorporate):",
    `  category: ${cluster.canonical.category}`,
    `  signal: "${cluster.canonical.signal.slice(0, 300).replace(/"/g, "'")}"`,
    `  occurrences: ${cluster.members.length}`,
    "  evidence:",
    evidence || "  (no evidence samples)",
    "",
    "Write the updated SKILL.md. Keep it tight.",
  ].join("\n");
}
