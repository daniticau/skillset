/**
 * Protected coverage pass — removes auto-created skills that duplicate or are
 * strict subsets of a user-authored skill. User-authored skills remain
 * immutable; the auto-created skill is archived and retired.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CONFLICTS_DIR } from "../../core/paths.js";
import { readState, writeState } from "../../core/config.js";
import { storeSkillDir } from "../../core/store.js";
import { readSkillMd } from "../../core/skill.js";
import type { LLMConfig } from "../llm/index.js";
import {
  chat,
  coverageSystemPrompt,
  coverageUserPrompt,
  parseLLMJson,
} from "../llm/index.js";
import { jaccardSimilarity, tokenSet } from "./similarity.js";

export interface CoverageFinding {
  covered: boolean;
  confidence: number;
  rationale: string;
}

export interface CoverageOutcome {
  redundant: string;
  coveredBy: string;
  archivePath?: string;
  finding: CoverageFinding;
  dryRun: boolean;
}

const MIN_CONFIDENCE = 0.8;
const MIN_TOKEN_OVERLAP = 0.15;

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

async function judgeCoverage(
  autoSkill: { name: string; body: string },
  userSkill: { name: string; body: string },
  config: LLMConfig
): Promise<CoverageFinding | null> {
  try {
    const result = await chat(config, {
      messages: [
        { role: "system", content: coverageSystemPrompt() },
        { role: "user", content: coverageUserPrompt(autoSkill, userSkill) },
      ],
      temperature: 0.1,
      maxTokens: 400,
    });
    return parseLLMJson<CoverageFinding>(result.content);
  } catch {
    return null;
  }
}

async function archiveRedundant(
  redundant: string,
  coveredBy: string,
  finding: CoverageFinding
): Promise<string> {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveDir = join(CONFLICTS_DIR, ts, "covered-by-user", redundant);
  await mkdir(archiveDir, { recursive: true });

  const redundantDir = storeSkillDir(redundant);
  if (existsSync(join(redundantDir, "SKILL.md"))) {
    const content = await readFile(join(redundantDir, "SKILL.md"), "utf8");
    await writeFile(join(archiveDir, "SKILL.md"), content, "utf8");
  }

  await writeFile(
    join(archiveDir, "CoverageFinding.json"),
    JSON.stringify(
      {
        redundant,
        coveredBy,
        resolvedAt: new Date().toISOString(),
        finding,
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  return archiveDir;
}

async function retireSkill(name: string, archivePath: string): Promise<void> {
  await rm(storeSkillDir(name), { recursive: true, force: true });

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

export async function runCoveredByUser(
  autoNames: string[],
  userNames: string[],
  config: LLMConfig,
  onEvent: (event: string, detail?: string) => void,
  options: { dryRun?: boolean } = {}
): Promise<CoverageOutcome[]> {
  if (autoNames.length === 0 || userNames.length === 0) return [];

  const autoInfos: Record<string, { body: string; description: string }> = {};
  const userInfos: Record<string, { body: string; description: string }> = {};
  for (const name of autoNames) {
    const info = await readSkillInfo(name);
    if (info) autoInfos[name] = info;
  }
  for (const name of userNames) {
    const info = await readSkillInfo(name);
    if (info) userInfos[name] = info;
  }

  const userTokenCache: Record<string, Set<string>> = {};
  for (const name of Object.keys(userInfos)) {
    userTokenCache[name] = tokenSet(`${name} ${userInfos[name]!.description}`);
  }

  const pairs: Array<{ autoName: string; userName: string; score: number }> = [];
  for (const autoName of Object.keys(autoInfos)) {
    const autoTokens = tokenSet(`${autoName} ${autoInfos[autoName]!.description}`);
    for (const userName of Object.keys(userInfos)) {
      const score = jaccardSimilarity(autoTokens, userTokenCache[userName]!);
      if (score >= MIN_TOKEN_OVERLAP) pairs.push({ autoName, userName, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  const outcomes: CoverageOutcome[] = [];
  const retired = new Set<string>();
  for (const { autoName, userName } of pairs) {
    if (retired.has(autoName)) continue;

    const finding = await judgeCoverage(
      { name: autoName, body: autoInfos[autoName]!.body },
      { name: userName, body: userInfos[userName]!.body },
      config
    );
    if (!finding || !finding.covered) continue;
    if (finding.confidence < MIN_CONFIDENCE) {
      onEvent("coverage-low-confidence", `${autoName} covered by ${userName} (${finding.confidence.toFixed(2)})`);
      continue;
    }

    const dryRun = options.dryRun === true;
    const archivePath = dryRun ? undefined : await archiveRedundant(autoName, userName, finding);
    if (archivePath) await retireSkill(autoName, archivePath);
    retired.add(autoName);

    onEvent(
      dryRun ? "coverage-candidate" : "coverage-retired",
      `${autoName} covered by ${userName}`
    );
    outcomes.push({
      redundant: autoName,
      coveredBy: userName,
      archivePath,
      finding,
      dryRun,
    });
  }

  return outcomes;
}
