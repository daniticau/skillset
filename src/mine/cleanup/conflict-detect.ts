/**
 * Conflict detection pass.
 *
 * For each pair of eligible (non-user-created) canonical skills, ask the LLM
 * if they directly contradict. Act only when:
 *   - conflict === true
 *   - confidence >= 0.8
 *   - quoteA / quoteB are non-empty AND are verbatim substrings of their
 *     respective skill bodies (so the LLM can't hallucinate a conflict)
 *
 * On a confirmed conflict the most-recently-modified skill wins by
 * state.lastEditedAt (falling back to state.createdAt). The loser is archived
 * to ~/.skillset/conflicts/<ts>/cleanup/<loser>/ with a ConflictFinding.json
 * sidecar, then removed from the canonical store.
 *
 * Dry-run reports the same confirmed candidates without archiving or deleting.
 */

import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CONFLICTS_DIR } from "../../core/paths.js";
import {
  readState,
  writeState,
} from "../../core/config.js";
import type { LLMConfig } from "../llm/index.js";
import {
  chat,
  parseLLMJson,
  conflictDetectSystemPrompt,
  conflictDetectUserPrompt,
} from "../llm/index.js";
import { storeSkillDir } from "../../core/store.js";
import { readSkillMd } from "../../core/skill.js";
import { jaccardSimilarity, tokenSet } from "./similarity.js";

export interface ConflictFinding {
  conflict: boolean;
  confidence: number;
  quoteA: string;
  quoteB: string;
  rationale: string;
}

export interface ConflictOutcome {
  winner: string;
  loser: string;
  archivePath?: string;
  finding: ConflictFinding;
  winnerModifiedAt: string;
  loserModifiedAt: string;
  dryRun: boolean;
}

const MIN_CONFIDENCE = 0.8;
const MIN_QUOTE_LENGTH = 10;

async function readSkillInfo(
  name: string
): Promise<{ body: string; description: string } | null> {
  try {
    const parsed = await readSkillMd(storeSkillDir(name));
    return {
      body: parsed.body,
      description: parsed.frontmatter.description,
    };
  } catch {
    return null;
  }
}

async function judgePair(
  a: { name: string; body: string },
  b: { name: string; body: string },
  config: LLMConfig
): Promise<ConflictFinding | null> {
  try {
    const result = await chat(config, {
      messages: [
        { role: "system", content: conflictDetectSystemPrompt() },
        { role: "user", content: conflictDetectUserPrompt(a, b) },
      ],
      temperature: 0.1,
      maxTokens: 400,
    });
    const parsed = parseLLMJson<ConflictFinding>(result.content);
    if (!parsed) return null;
    return parsed;
  } catch {
    return null;
  }
}

function verifyQuote(haystack: string, quote: string): boolean {
  if (quote.length < MIN_QUOTE_LENGTH) return false;
  return haystack.includes(quote.trim());
}

async function modifiedAt(name: string): Promise<string> {
  const state = await readState();
  const s = state.skills[name];
  if (!s) return "0000-00-00T00:00:00Z";
  return s.lastEditedAt ?? s.createdAt ?? "0000-00-00T00:00:00Z";
}

async function archiveLoser(
  loser: string,
  winner: string,
  finding: ConflictFinding
): Promise<string> {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = join(CONFLICTS_DIR, ts, "cleanup", loser);
  await mkdir(dir, { recursive: true });

  const loserDir = storeSkillDir(loser);
  if (existsSync(join(loserDir, "SKILL.md"))) {
    const loserContent = await readFile(join(loserDir, "SKILL.md"), "utf8");
    await writeFile(join(dir, "SKILL.md"), loserContent, "utf8");
  }

  const state = await readState();
  const loserState = state.skills[loser];
  if (loserState?.userEdited) {
    await writeFile(
      join(dir, "preserved-user-edits.md"),
      `# preserved-user-edits\n\nThis skill (${loser}) had userEdited=true at the time cleanup resolved it against ${winner}. The user edits are captured in SKILL.md in this archive.\n`,
      "utf8"
    );
  }

  await writeFile(
    join(dir, "ConflictFinding.json"),
    JSON.stringify(
      {
        loser,
        winner,
        resolvedAt: new Date().toISOString(),
        finding,
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  return dir;
}

/**
 * Remove a skill from the canonical store AND state. Mirror pruning happens on
 * the next sync pass.
 */
async function retireSkill(name: string, archivePath: string): Promise<void> {
  const dir = storeSkillDir(name);
  await rm(dir, { recursive: true, force: true });

  const state = await readState();
  if (state.skills[name]) {
    state.skills[name].lostInCleanup = {
      at: new Date().toISOString(),
      archivePath,
    };
    delete state.skills[name];
  }
  await writeState(state);
}

/**
 * Find eligible pairs with overlapping topics via lightweight
 * description-token overlap. Keeps the pair count manageable without needing
 * embeddings.
 */
function candidatePairs(
  infos: Record<string, { body: string; description: string }>
): Array<[string, string]> {
  const names = Object.keys(infos);
  const tokenCache: Record<string, Set<string>> = {};
  for (const name of names) {
    tokenCache[name] = tokenSet(`${name} ${infos[name]!.description}`);
  }

  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i]!;
      const b = names[j]!;
      if (jaccardSimilarity(tokenCache[a]!, tokenCache[b]!) >= 0.3) {
        pairs.push([a, b]);
      }
    }
  }
  return pairs;
}

export async function runConflictDetection(
  names: string[],
  config: LLMConfig,
  onEvent: (event: string, detail?: string) => void,
  options: { dryRun?: boolean } = {}
): Promise<ConflictOutcome[]> {
  if (names.length < 2) return [];

  // Load bodies upfront.
  const infos: Record<string, { body: string; description: string }> = {};
  for (const n of names) {
    const info = await readSkillInfo(n);
    if (info) infos[n] = info;
  }

  const outcomes: ConflictOutcome[] = [];
  const retired = new Set<string>();

  for (const [a, b] of candidatePairs(infos)) {
    if (retired.has(a) || retired.has(b)) continue;
    const bodyA = infos[a]!.body;
    const bodyB = infos[b]!.body;
    const finding = await judgePair({ name: a, body: bodyA }, { name: b, body: bodyB }, config);
    if (!finding || !finding.conflict) continue;
    if (finding.confidence < MIN_CONFIDENCE) {
      onEvent("conflict-low-confidence", `${a} ↔ ${b} (${finding.confidence.toFixed(2)})`);
      continue;
    }
    if (!verifyQuote(bodyA, finding.quoteA) || !verifyQuote(bodyB, finding.quoteB)) {
      onEvent("conflict-bad-quote", `${a} ↔ ${b} — quotes not verbatim`);
      continue;
    }

    const mtA = await modifiedAt(a);
    const mtB = await modifiedAt(b);
    const [winner, loser] = mtA >= mtB ? [a, b] : [b, a];
    const dryRun = options.dryRun === true;
    onEvent(
      dryRun ? "conflict-candidate" : "conflict-resolved",
      `${winner} over ${loser} (confidence ${finding.confidence.toFixed(2)})`
    );

    const archivePath = dryRun ? undefined : await archiveLoser(loser, winner, finding);
    if (archivePath) {
      await retireSkill(loser, archivePath);
    }
    retired.add(loser);

    outcomes.push({
      winner,
      loser,
      archivePath,
      finding,
      winnerModifiedAt: winner === a ? mtA : mtB,
      loserModifiedAt: loser === a ? mtA : mtB,
      dryRun,
    });
  }
  return outcomes;
}
