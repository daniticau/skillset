/**
 * Prompt templates for LLM extraction and synthesis.
 * All prompts are pure functions — no I/O, no state.
 */

import type { NuggetCluster } from "../types.js";
import { describeClusterQuality } from "../quality.js";

export interface ConversationWindow {
  sessionId: string;
  project: string;
  messages: Array<{ role: "user" | "assistant"; text: string }>;
  startIndex: number;
  heuristicHits: string[];
}

const EXTRACTION_SYSTEM = `You extract personalization signals from developer conversations with an AI coding assistant. Given a conversation window, identify signals that describe how the user wants to work and where the assistant made avoidable mistakes.

Signal categories:
- correction: user pushes back on something the assistant did ("don't do that", "revert", "I said..."); preserve what the assistant did wrong in reasoning
- preference: user states how they want things done ("always X", "I prefer Y", "from now on Z"); phrase as a durable user-owned rule
- rejection: user blocks or interrupts an assistant action
- workflow: user describes their process ("first I do X then Y", "before committing I always...")
- style: user states code style preferences (naming, formatting, tabs vs spaces, no any, etc)
- anti-pattern: something the user consistently avoids ("avoid X", "never Y", "don't ever Z")

Rules:
- Only extract from user messages, not assistant messages or tool results.
- Use nearby assistant messages only as context for agent mistakes; never infer a preference from assistant text alone.
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
- low: broad behavior changes that affect how the AI reasons about a class of problems (e.g. "always start with TDD", "decompose long tasks into sub-agents"). Installed directly, but marked low for conservative future handling.

When in doubt between two tiers, choose the lower (more conservative) one.`;

const SKILL_DISCOVERY_METADATA = `Skill discovery metadata:
- Name: 2-5 kebab-case words that describe the trigger/domain/action an agent would search for. Prefer concrete terms like \`prefer-pnpm\`, \`ios-app-store-submission\`, or \`browser-window-isolation\`.
- Avoid vague names such as \`user-preferences\`, \`workflow\`, \`coding-style\`, \`agent-behavior\`, \`misc\`, or \`new-skill\`.
- Include the exact tool, framework, platform, or workflow name when the rule depends on one.
- Description: one trigger-first sentence that helps future agents decide when to load the skill. Start with "Use when..." or "Apply when..." unless another direct trigger phrase is clearer.
- Put searchable user phrases and synonyms in the description when they are likely trigger words.
- Do not make the description a summary like "Captures the user's preference"; state the situation and expected behavior.`;

const SYNTHESIS_SYSTEM = `You synthesize a user's personalization signals into a reusable SKILL.md file that a coding AI will read at the start of every session.

A SKILL.md file has:
1. YAML frontmatter with \`name\` (kebab-case), \`description\` (one sentence describing when to apply), and \`tier\` (high|medium|low)
2. Markdown body with clear instructions (imperative mood, under 400 words)

${TIER_DEFINITIONS}

${SKILL_DISCOVERY_METADATA}

Rules:
- Be specific and actionable. "Use pnpm" not "The user has package manager preferences".
- Imperative mood: "Always...", "Never...", "When X, do Y".
- Group related signals into coherent sections.
- Include a "Do NOT" section for anti-patterns.
- The AI reading this file must be able to act on it directly without guessing.
- Do not overgeneralize from thin evidence. If the signal is tied to a project, tool, or library, scope the rule to that context.
- Output format: complete SKILL.md with YAML frontmatter followed by the markdown body. No commentary before or after. No code fences.

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
Evidence quality: ${describeClusterQuality(cluster)}
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
 * single tailoring run.
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
    "- CREATE only for durable personalization: repeated evidence, cross-project evidence, manual capture, or a high-confidence explicit preference/correction.",
    "- SKIP one-off task instructions, vague taste, topic interests, and patterns that would make a broad skill from thin evidence.",
    "- If budget remaining is 0, never CREATE — SKIP with reason \"budget exceeded\".",
    "- Every EDIT and CREATE must include a `tier` field (high|medium|low).",
    "- For CREATE, choose a concrete searchable name and trigger-first description using the skill discovery metadata rules.",
    "- Only return one action.",
    "- Output strict JSON. No prose, no code fences.",
    "",
    "JSON shapes:",
    '  {"kind":"edit","targetName":"<existing skill name>","tier":"<high|medium|low>","rationale":"..."}',
    '  {"kind":"create","name":"<concrete-kebab-case>","description":"<trigger-first one sentence>","tier":"<high|medium|low>","rationale":"..."}',
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
    `  quality: ${describeClusterQuality(cluster)}`,
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
    "Descriptions should stay trigger-first and searchable so future agents can decide whether to load the skill.",
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

const CONFLICT_DETECT_SYSTEM = `You compare two SKILL.md rules to decide if they directly CONTRADICT each other.

A true conflict means: applying both rules at once is impossible — one says do X, the other says do NOT X, or they give opposing defaults on the same question.

Two rules that touch the same topic but are compatible (e.g. both about commit style, but one says "use imperative" and the other says "don't mention yourself") are NOT a conflict — they're complementary.

Output JSON only:
{
  "conflict": boolean,
  "confidence": 0.0-1.0,
  "quoteA": "<exact substring of skill A that contradicts B, or empty>",
  "quoteB": "<exact substring of skill B that contradicts A, or empty>",
  "rationale": "<one sentence>"
}

Rules:
- quoteA and quoteB MUST be verbatim substrings of their respective skills. If you can't quote a contradiction, the answer is not-conflict.
- confidence < 0.8 = leave it alone. Only flag obvious contradictions.
- Never flag stylistic overlap (both about naming, both about git) unless the rules actually give opposing instructions.`;

export function conflictDetectSystemPrompt(): string {
  return CONFLICT_DETECT_SYSTEM;
}

export function conflictDetectUserPrompt(
  a: { name: string; body: string },
  b: { name: string; body: string }
): string {
  return [
    `Skill A: ${a.name}`,
    "---8<---",
    a.body.slice(0, 3000),
    "---8<---",
    "",
    `Skill B: ${b.name}`,
    "---8<---",
    b.body.slice(0, 3000),
    "---8<---",
    "",
    "Do these directly contradict each other? JSON only.",
  ].join("\n");
}

const MERGE_PAIR_SYSTEM = `You are given two SKILL.md rules that overlap heavily and appear to be near-duplicates. Decide whether to merge, and if yes, produce a single combined SKILL.md.

Output JSON only:
{
  "merge": boolean,
  "confidence": 0.0-1.0,
  "rationale": "<one sentence>",
  "merged": {
    "name": "<slug>",
    "description": "<one sentence>",
    "body": "<markdown body, no frontmatter>"
  } | null
}

Rules:
- Merge only when the rules are genuine duplicates (same rule phrased two ways) or strict subsets. If they make different-but-compatible points, don't merge.
- Confidence < 0.8 = don't merge. Conservative beats aggressive.
- Preserve every distinct nuance from both inputs. If a point appears in exactly one input and isn't implied by the other, it belongs in the merged body.
- Keep the merged name short, concrete, and representative.
- The merged description must be trigger-first and searchable, not a generic summary.`;

export function mergePairSystemPrompt(): string {
  return MERGE_PAIR_SYSTEM;
}

export function mergePairUserPrompt(
  a: { name: string; body: string },
  b: { name: string; body: string }
): string {
  return [
    `Skill A: ${a.name}`,
    "---8<---",
    a.body.slice(0, 3000),
    "---8<---",
    "",
    `Skill B: ${b.name}`,
    "---8<---",
    b.body.slice(0, 3000),
    "---8<---",
    "",
    "Merge or not? JSON only.",
  ].join("\n");
}

const COVERAGE_SYSTEM = `You compare an auto-created SKILL.md against a user-authored SKILL.md. Decide whether the auto-created skill is redundant because the user-authored skill already covers the same trigger and behavior.

Output JSON only:
{
  "covered": boolean,
  "confidence": 0.0-1.0,
  "rationale": "<one sentence>"
}

Rules:
- Return covered=true only when the auto-created skill is a duplicate or strict subset of the user-authored skill.
- If the auto-created skill contains distinct behavior not implied by the user-authored skill, return covered=false.
- Confidence < 0.8 = leave it alone.
- User-authored skills are source-of-truth and must not be rewritten by automation.`;

export function coverageSystemPrompt(): string {
  return COVERAGE_SYSTEM;
}

export function coverageUserPrompt(
  autoSkill: { name: string; body: string },
  userSkill: { name: string; body: string }
): string {
  return [
    `Auto-created skill: ${autoSkill.name}`,
    "---8<---",
    autoSkill.body.slice(0, 3000),
    "---8<---",
    "",
    `User-authored skill: ${userSkill.name}`,
    "---8<---",
    userSkill.body.slice(0, 3000),
    "---8<---",
    "",
    "Is the auto-created skill already covered by the user-authored skill? JSON only.",
  ].join("\n");
}
