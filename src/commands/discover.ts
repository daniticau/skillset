import pc from "picocolors";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  renderDiscoverSkill,
  searchOrthogonal,
  type DiscoverCandidate,
} from "../discover/orthogonal.js";
import { listStoreSkills } from "../core/store.js";
import { DRAFTS_DIR, writeDraftSkill } from "../mine/synthesize.js";

export interface DiscoverCmdOptions {
  query?: string;
  max?: number;
  minScore?: number;
  includeUnverified?: boolean;
  dryRun?: boolean;
}

function capMax(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(Math.floor(n), 20));
}

function priceLabel(candidate: DiscoverCandidate): string {
  return candidate.price ? `$${candidate.price}` : "price unknown";
}

function lineFor(candidate: DiscoverCandidate): string {
  const score = candidate.score === undefined ? "score ?" : `score ${candidate.score.toFixed(2)}`;
  const verified = candidate.verified === false ? "unverified" : "verified";
  return `${pc.bold(candidate.skillName)} ${pc.dim(`${candidate.endpointMethod} ${candidate.endpointPath}`)} ${pc.dim(`${score}, ${verified}, ${priceLabel(candidate)}`)}`;
}

export async function discoverCommand(options: DiscoverCmdOptions): Promise<void> {
  const query = options.query?.trim();
  if (!query) {
    console.log(pc.yellow("missing --query text for Orthogonal discovery"));
    return;
  }

  const apiKey = process.env.ORTHOGONAL_API_KEY;
  if (!apiKey) {
    console.log(pc.yellow("ORTHOGONAL_API_KEY is not set"));
    console.log(pc.dim("  add it to ~/.skillset/.env or your shell, then rerun skillset discover"));
    return;
  }

  const max = capMax(options.max);
  const minScore = options.minScore ?? 0.5;
  const includeUnverified = options.includeUnverified === true;
  const candidates = await searchOrthogonal({
    apiKey,
    query,
    max,
    minScore,
    includeUnverified,
    baseUrl: process.env.ORTHOGONAL_BASE_URL,
  });

  if (candidates.length === 0) {
    console.log(pc.dim("no Orthogonal candidates matched"));
    return;
  }

  console.log(pc.bold(`${candidates.length} Orthogonal candidate(s):`));
  for (const candidate of candidates) {
    console.log(`  ${pc.green("●")} ${lineFor(candidate)}`);
  }

  if (options.dryRun) {
    console.log(pc.yellow("dry-run - no drafts written"));
    return;
  }

  const existingCanonical = new Set(await listStoreSkills());
  let written = 0;
  for (const candidate of candidates) {
    const draftDir = join(DRAFTS_DIR, candidate.skillName);
    if (existingCanonical.has(candidate.skillName) || existsSync(draftDir)) {
      console.log(pc.dim(`  already exists: ${candidate.skillName}`));
      continue;
    }
    const path = await writeDraftSkill(renderDiscoverSkill(candidate, query));
    console.log(pc.dim(`  -> ${path}`));
    written += 1;
  }

  console.log();
  console.log(pc.bold(`${written} draft skill(s) written`));
  if (written > 0) {
    console.log(pc.dim(`  review drafts: ${pc.bold("skillset drafts")}`));
    console.log(pc.dim(`  promote:       ${pc.bold("skillset promote <name>")}`));
  }
}
