/**
 * Dedup merge pass — finds near-duplicate skills and fuses them into one.
 *
 * Pair filter: simple description+name token overlap (Jaccard >= 0.3) so we
 * don't LLM-judge every O(n^2) pair. Embeddings would be stronger; add later.
 *
 * LLM gate: same strict threshold as conflict-detect (confidence >= 0.8,
 * non-empty merged body). On merge:
 *   - Write the merged SKILL.md into canonical as a NEW skill (origin auto).
 *   - Archive both predecessors to ~/.skillset/conflicts/<ts>/cleanup-merge/.
 *   - Remove predecessors from canonical + state.
 *
 * Cap: mergeCap per cycle.
 */

import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CONFLICTS_DIR } from "../../core/paths.js";
import {
  readState,
  writeState,
  initialSkillState,
} from "../../core/config.js";
import type { LLMConfig } from "../llm/index.js";
import {
  chat,
  parseLLMJson,
  mergePairSystemPrompt,
  mergePairUserPrompt,
} from "../llm/index.js";
import { storeSkillDir } from "../../core/store.js";
import { readSkillMd, renderSkillMd } from "../../core/skill.js";

export interface MergeFinding {
  merge: boolean;
  confidence: number;
  rationale: string;
  merged: { name: string; description: string; body: string } | null;
}

export interface MergeOutcome {
  replaced: string[];
  produced: string;
  archivePath: string;
  finding: MergeFinding;
}

const MIN_CONFIDENCE = 0.8;

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const inter = [...a].filter((x) => b.has(x)).length;
  const uni = new Set([...a, ...b]).size;
  return uni === 0 ? 0 : inter / uni;
}

async function readSkill(
  name: string
): Promise<{ body: string; description: string } | null> {
  try {
    const parsed = await readSkillMd(storeSkillDir(name));
    return { body: parsed.body, description: parsed.frontmatter.description };
  } catch {
    return null;
  }
}

async function judgeMerge(
  a: { name: string; body: string },
  b: { name: string; body: string },
  config: LLMConfig
): Promise<MergeFinding | null> {
  try {
    const result = await chat(config, {
      messages: [
        { role: "system", content: mergePairSystemPrompt() },
        { role: "user", content: mergePairUserPrompt(a, b) },
      ],
      temperature: 0.1,
      maxTokens: 1500,
    });
    return parseLLMJson<MergeFinding>(result.content);
  } catch {
    return null;
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

async function archiveAndRetire(
  name: string,
  archiveDir: string
): Promise<void> {
  const dir = storeSkillDir(name);
  const dst = join(archiveDir, name);
  await mkdir(dst, { recursive: true });
  if (existsSync(join(dir, "SKILL.md"))) {
    const content = await readFile(join(dir, "SKILL.md"), "utf8");
    await writeFile(join(dst, "SKILL.md"), content, "utf8");
  }
  const state = await readState();
  if (state.skills[name]) {
    state.skills[name].lostInCleanup = {
      at: new Date().toISOString(),
      archivePath: dst,
    };
    delete state.skills[name];
  }
  await writeState(state);
  await rm(dir, { recursive: true, force: true });
}

async function writeMergedSkill(
  name: string,
  description: string,
  body: string
): Promise<void> {
  const dir = storeSkillDir(name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    renderSkillMd(
      {
        name,
        description,
        origin: "auto-created",
      },
      body
    ),
    "utf8"
  );
  const state = await readState();
  state.skills[name] = initialSkillState("auto-created", {
    createdBy: "cleanup",
  });
  await writeState(state);
}

export async function runDedupMerge(
  names: string[],
  config: LLMConfig,
  cap: number,
  onEvent: (event: string, detail?: string) => void
): Promise<MergeOutcome[]> {
  if (names.length < 2 || cap <= 0) return [];

  const infos: Record<string, { body: string; description: string }> = {};
  for (const n of names) {
    const info = await readSkill(n);
    if (info) infos[n] = info;
  }

  // Candidate pairs filtered by token overlap on (name + description) to cut
  // the LLM call count. Full-body Jaccard would be stronger but also slower.
  const nameList = Object.keys(infos);
  const tokenCache: Record<string, Set<string>> = {};
  for (const n of nameList) {
    tokenCache[n] = tokens(n + " " + infos[n]!.description);
  }

  const pairs: Array<{ a: string; b: string; score: number }> = [];
  for (let i = 0; i < nameList.length; i++) {
    for (let j = i + 1; j < nameList.length; j++) {
      const score = jaccard(tokenCache[nameList[i]!]!, tokenCache[nameList[j]!]!);
      if (score >= 0.3) pairs.push({ a: nameList[i]!, b: nameList[j]!, score });
    }
  }
  pairs.sort((x, y) => y.score - x.score);

  const outcomes: MergeOutcome[] = [];
  const consumed = new Set<string>();

  for (const { a, b } of pairs) {
    if (outcomes.length >= cap) break;
    if (consumed.has(a) || consumed.has(b)) continue;

    const finding = await judgeMerge(
      { name: a, body: infos[a]!.body },
      { name: b, body: infos[b]!.body },
      config
    );
    if (!finding || !finding.merge) continue;
    if (finding.confidence < MIN_CONFIDENCE) {
      onEvent("merge-low-confidence", `${a} + ${b} (${finding.confidence.toFixed(2)})`);
      continue;
    }
    if (!finding.merged || !finding.merged.name || !finding.merged.body) {
      onEvent("merge-incomplete", `${a} + ${b} — missing merged content`);
      continue;
    }

    const mergedName = slugify(finding.merged.name) || a;
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const archiveDir = join(CONFLICTS_DIR, ts, "cleanup-merge", mergedName);

    await archiveAndRetire(a, archiveDir);
    await archiveAndRetire(b, archiveDir);
    await writeMergedSkill(mergedName, finding.merged.description, finding.merged.body);

    onEvent("merged", `${a} + ${b} → ${mergedName}`);
    outcomes.push({
      replaced: [a, b],
      produced: mergedName,
      archivePath: archiveDir,
      finding,
    });
    consumed.add(a);
    consumed.add(b);
  }

  return outcomes;
}
