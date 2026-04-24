import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  readConfig,
  readState,
  writeState,
  initialSkillState,
} from "./config.js";
import type { ConflictRecord, Link, SkillState, State } from "./config.js";
import { hashSkillDir, readSkillMd, renderSkillMd } from "./skill.js";
import type { ParsedSkill, SkillFrontmatter, SkillOrigin } from "./skill.js";
import {
  listStoreSkills,
  storeSkillDir,
  validateStoreSkill,
} from "./store.js";
import { getAdapter } from "./adapters/index.js";
import type { AgentAdapter } from "./adapters/index.js";
import { CONFLICTS_DIR } from "./paths.js";

export type SyncAction =
  | { kind: "promoted"; skill: string; from: Link }
  | { kind: "mirrored"; skill: string; to: Link }
  | { kind: "adopted"; skill: string; from: Link }
  | { kind: "conflict"; skill: string; winner: Link; losers: Link[]; archive: string }
  | { kind: "removed-from-mirror"; skill: string; link: Link };

export interface SyncReport {
  actions: SyncAction[];
  skillCount: number;
  linkCount: number;
}

function linkKey(link: Link): string {
  return `${link.agent}:${link.path}`;
}

/**
 * Merge a skill parsed from a mirror with a canonical's prior frontmatter so
 * that metadata the mirror format can't carry (tier on cursor .mdc, origin on
 * every adapter today) survives round-trip edits.
 *
 * Priority: mirror value > prior canonical value > default. For origin, default
 * is `fallbackOrigin` — callers pass "user-created" for adoption, and the prior
 * origin (via prior.origin) for promotion, so auto-created never silently
 * downgrades to user-created.
 */
function mergeFrontmatter(
  mirror: SkillFrontmatter,
  prior: SkillFrontmatter | null,
  fallbackOrigin: SkillOrigin
): SkillFrontmatter {
  return {
    name: mirror.name,
    description: mirror.description,
    tier: mirror.tier ?? prior?.tier,
    license: mirror.license ?? prior?.license,
    origin: mirror.origin ?? prior?.origin ?? fallbackOrigin,
  };
}

/**
 * Write a ParsedSkill back to the canonical store (after promotion or adoption
 * from a mirror). Only writes SKILL.md; doesn't touch other files that may
 * coexist in the canonical dir for per-dir layouts.
 *
 * Reads the prior canonical frontmatter (if any) to preserve tier/license/origin
 * when the mirror format can't carry them.
 */
async function writeCanonicalSkillFile(
  skill: ParsedSkill,
  fallbackOrigin: SkillOrigin
): Promise<void> {
  const dir = storeSkillDir(skill.frontmatter.name);
  await mkdir(dir, { recursive: true });
  let prior: SkillFrontmatter | null = null;
  if (existsSync(join(dir, "SKILL.md"))) {
    try {
      const parsedPrior = await readSkillMd(dir);
      prior = parsedPrior.frontmatter;
    } catch {
      prior = null;
    }
  }
  const merged = mergeFrontmatter(skill.frontmatter, prior, fallbackOrigin);
  await writeFile(join(dir, "SKILL.md"), renderSkillMd(merged, skill.body), "utf8");
}

/**
 * When 2+ mirrors of the same skill have diverged from canonical, the newest
 * mtime wins; the rest are archived to ~/.skillset/conflicts/<ts>/<skill>/<adapter>/
 * with a CONTEXT.md describing the conflict, so the user can recover lost work.
 */
async function archiveLosers(
  skillName: string,
  losers: Array<{
    link: Link;
    adapter: AgentAdapter;
    key: string;
    hash: string;
    mtime: number;
  }>,
  canonicalHashBefore: string,
  winner: { link: Link; key: string; mtime: number }
): Promise<string> {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveRoot = join(CONFLICTS_DIR, ts, skillName);
  await mkdir(archiveRoot, { recursive: true });
  for (const loser of losers) {
    const adapterDir = join(archiveRoot, loser.link.agent);
    await mkdir(adapterDir, { recursive: true });
    const parsed = loser.adapter.readMirrorSkill
      ? await loser.adapter.readMirrorSkill(skillName, loser.link.path)
      : null;
    if (parsed) {
      await writeFile(
        join(adapterDir, "SKILL.md"),
        renderSkillMd(parsed.frontmatter, parsed.body),
        "utf8"
      );
    }
    const ctx = [
      `# Conflict — ${skillName}`,
      ``,
      `Recorded at: ${new Date().toISOString()}`,
      `This mirror lost the conflict (older mtime).`,
      ``,
      `- Loser adapter: ${loser.link.agent} (${loser.link.path})`,
      `- Loser mtime: ${new Date(loser.mtime).toISOString()}`,
      `- Loser hash:  ${loser.hash}`,
      ``,
      `- Winner adapter: ${winner.link.agent} (${winner.link.path})`,
      `- Winner mtime:   ${new Date(winner.mtime).toISOString()}`,
      ``,
      `- Canonical hash before conflict: ${canonicalHashBefore || "(none — first sync)"}`,
      ``,
      `Recover by editing the canonical store at ~/.skillset/skills/${skillName}/SKILL.md and merging desired content from this archive.`,
      ``,
    ].join("\n");
    await writeFile(join(adapterDir, "CONTEXT.md"), ctx, "utf8");
  }
  return archiveRoot;
}

/** Adoption pass: any skill that exists in a per-skill mirror but not in the
 *  canonical store gets promoted into canonical.  Aggregate-file mirrors are
 *  skipped — v1 doesn't support user-edit promotion from a shared file.
 *
 *  Mirror-born skills are tagged origin="user-created" — the user put them there,
 *  so automation must never touch them. */
async function adoptFromMirrors(
  config: { links: Link[] },
  state: State,
  actions: SyncAction[]
): Promise<void> {
  for (const link of config.links) {
    const adapter = getAdapter(link.agent);
    if (adapter.layout === "aggregate-file") continue;
    if (!adapter.listMirrorSkills || !adapter.readMirrorSkill) continue;
    const mirrorNames = await adapter.listMirrorSkills(link.path);
    for (const name of mirrorNames) {
      if (state.skills[name]) continue; // already tracked
      const parsed = await adapter.readMirrorSkill(name, link.path);
      if (!parsed) continue;
      await writeCanonicalSkillFile(parsed, "user-created");
      // Seed state so the next pass treats the skill as tracked. canonicalHash
      // and mirrorHashes get filled in the main loop below.
      state.skills[name] = initialSkillState("user-created", {
        createdBy: "manual",
      });
      actions.push({ kind: "adopted", skill: name, from: link });
    }
  }
}

/**
 * One sync pass:
 *   1. Adopt unknown mirror skills into canonical (per-skill layouts only).
 *   2. For each canonical skill + each per-skill mirror: detect user edits
 *      (mirror hash != recorded) → promote mirror → canonical.
 *   3. Push canonical → every per-skill mirror, record new hashes.
 *   4. Rewrite aggregate-file mirrors (Codex) with the whole canonical set.
 *   5. Prune mirror-side skills that are no longer in canonical.
 */
export async function sync(): Promise<SyncReport> {
  const config = await readConfig();
  const state = await readState();
  const actions: SyncAction[] = [];

  await adoptFromMirrors(config, state, actions);

  const storeSkillNames = await listStoreSkills();
  const storeSkillNameSet = new Set(storeSkillNames);
  const aggregateParsedSkills: ParsedSkill[] = [];

  for (const name of storeSkillNames) {
    await validateStoreSkill(name);
    const canonicalDir = storeSkillDir(name);
    // When state lacks this skill (first sync after promote / manual add), seed
    // origin from canonical frontmatter — which is the source of truth. Missing
    // frontmatter origin falls back to "user-created" (safest default).
    let prior = state.skills[name];
    if (!prior) {
      const canonicalParsed = await readSkillMd(canonicalDir).catch(() => null);
      const fmOrigin: SkillOrigin =
        canonicalParsed?.frontmatter.origin ?? "user-created";
      prior = initialSkillState(fmOrigin);
    }
    const current: SkillState = {
      ...prior,
      mirrorHashes: { ...prior.mirrorHashes },
    };

    const canonicalHashBefore = prior.canonicalHash;
    const divergences: Array<{
      link: Link;
      adapter: AgentAdapter;
      key: string;
      hash: string;
      mtime: number;
    }> = [];
    for (const link of config.links) {
      const adapter = getAdapter(link.agent);
      if (adapter.layout === "aggregate-file") continue;
      if (!adapter.hashMirrorSkill) continue;
      const key = linkKey(link);
      const recorded = prior.mirrorHashes[key];
      const mirrorHash = await adapter.hashMirrorSkill(name, link.path);
      if (!mirrorHash || !recorded || mirrorHash === recorded) continue;
      const mtime = adapter.mirrorSkillMtimeMs
        ? (await adapter.mirrorSkillMtimeMs(name, link.path)) ?? 0
        : 0;
      divergences.push({ link, adapter, key, hash: mirrorHash, mtime });
    }

    if (divergences.length === 1) {
      const { link, adapter } = divergences[0]!;
      const mirrorParsed = adapter.readMirrorSkill
        ? await adapter.readMirrorSkill(name, link.path)
        : null;
      if (mirrorParsed) {
        // Preserve the prior origin — a user edit on an auto-created skill does
        // NOT make it user-created; it sets userEdited=true instead.
        await writeCanonicalSkillFile(mirrorParsed, prior.origin);
        current.userEdited = true;
        current.lastEditedAt = new Date().toISOString();
        actions.push({ kind: "promoted", skill: name, from: link });
      }
    } else if (divergences.length >= 2) {
      divergences.sort((a, b) => b.mtime - a.mtime);
      const winner = divergences[0]!;
      const losers = divergences.slice(1);
      const archive = await archiveLosers(name, losers, canonicalHashBefore, winner);
      const winnerParsed = winner.adapter.readMirrorSkill
        ? await winner.adapter.readMirrorSkill(name, winner.link.path)
        : null;
      if (winnerParsed) {
        await writeCanonicalSkillFile(winnerParsed, prior.origin);
        current.userEdited = true;
        current.lastEditedAt = new Date().toISOString();
      }
      const record: ConflictRecord = {
        at: new Date().toISOString(),
        winnerAdapter: winner.key,
        loserCount: losers.length,
      };
      current.conflictHistory = [...(prior.conflictHistory ?? []), record];
      actions.push({
        kind: "conflict",
        skill: name,
        winner: winner.link,
        losers: losers.map((l) => l.link),
        archive,
      });
    }

    current.canonicalHash = await hashSkillDir(canonicalDir);

    const freshParsed = await readSkillMd(canonicalDir);
    aggregateParsedSkills.push(freshParsed);
    for (const link of config.links) {
      const adapter = getAdapter(link.agent);
      if (adapter.layout === "aggregate-file") continue;
      if (!adapter.mirrorSkill || !adapter.hashMirrorSkill) continue;
      await adapter.mirrorSkill(freshParsed, link.path);
      const key = linkKey(link);
      const newHash = await adapter.hashMirrorSkill(name, link.path);
      if (newHash) current.mirrorHashes[key] = newHash;
      actions.push({ kind: "mirrored", skill: name, to: link });
    }

    state.skills[name] = current;
  }

  // Aggregate-file layouts: rewrite once with the whole canonical set.
  for (const link of config.links) {
    const adapter = getAdapter(link.agent);
    if (adapter.layout !== "aggregate-file" || !adapter.mirrorAll) continue;
    await adapter.mirrorAll(aggregateParsedSkills, link.path);
    for (const name of storeSkillNames) {
      actions.push({ kind: "mirrored", skill: name, to: link });
    }
  }

  // Prune mirror-side skills no longer in canonical.
  for (const link of config.links) {
    const adapter = getAdapter(link.agent);
    if (adapter.layout === "aggregate-file") continue;
    if (!adapter.listMirrorSkills || !adapter.removeMirrorSkill) continue;
    const mirrorNames = await adapter.listMirrorSkills(link.path);
    for (const name of mirrorNames) {
      if (storeSkillNameSet.has(name)) continue;
      await adapter.removeMirrorSkill(name, link.path);
      actions.push({ kind: "removed-from-mirror", skill: name, link });
    }
  }

  // Prune state entries for skills no longer in the canonical store.
  for (const name of Object.keys(state.skills)) {
    if (!storeSkillNameSet.has(name)) delete state.skills[name];
  }

  await writeState(state);

  return {
    actions,
    skillCount: storeSkillNames.length,
    linkCount: config.links.length,
  };
}

export async function status(): Promise<{
  skills: Array<{
    name: string;
    userEdited: boolean;
    origin: SkillOrigin;
    mirrors: string[];
    conflicts: number;
    lastConflictAt?: string;
  }>;
  links: Array<Link & { layout: AgentAdapter["layout"] }>;
}> {
  const config = await readConfig();
  const state = await readState();
  const storeSkillNames = await listStoreSkills();
  return {
    skills: storeSkillNames.map((name) => {
      const s: State["skills"][string] | undefined = state.skills[name];
      const history = s?.conflictHistory ?? [];
      return {
        name,
        userEdited: s?.userEdited ?? false,
        origin: s?.origin ?? "user-created",
        mirrors: Object.keys(s?.mirrorHashes ?? {}),
        conflicts: history.length,
        lastConflictAt: history.length > 0 ? history[history.length - 1]!.at : undefined,
      };
    }),
    links: config.links.map((link) => {
      let layout: AgentAdapter["layout"];
      try {
        layout = getAdapter(link.agent).layout;
      } catch {
        layout = "per-skill-dir";
      }
      return { ...link, layout };
    }),
  };
}
