import { existsSync, realpathSync } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
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
  copyDirReplace,
  storeSkillDir,
} from "./store.js";
import { getAdapter } from "./adapters/index.js";
import type { AgentAdapter } from "./adapters/index.js";
import { CONFLICTS_DIR, STORE_SKILLS_DIR } from "./paths.js";
import { appendHistoryEvent, sharedSkillAgents } from "./history.js";

export type SyncAction =
  | { kind: "promoted"; skill: string; from: Link }
  | { kind: "mirrored"; skill: string; to: Link }
  | { kind: "adopted"; skill: string; from: Link }
  | {
      kind: "conflict";
      skill: string;
      winner: Link;
      losers: Link[];
      archive: string;
      winnerLabel?: string;
      loserLabels?: string[];
      archivedLoserCount?: number;
    }
  | { kind: "removed-from-mirror"; skill: string; link: Link };

export interface SyncReport {
  actions: SyncAction[];
  skillCount: number;
  linkCount: number;
  /**
   * Skills that could not be reconciled this pass. Recorded rather than thrown:
   * one unreadable skill, or one whose mirror points somewhere unwritable (a
   * skill linked into a signed app bundle, say), must not abort the run and
   * leave canonical mutated with state.json unwritten and mirrors half-done.
   */
  failures: Array<{ skill: string; error: string }>;
}

export interface SyncOptions {
  /**
   * When true, compare existing skills in all linked mirrors against canonical
   * before writing. Used by init/connect/doctor --repair so an existing mirror
   * is imported instead of being overwritten on first contact.
   */
  importExisting?: boolean;
  /** When false, do not adopt mirror-only skills before mirroring. */
  adoptUntracked?: boolean;
}

function linkKey(link: Link): string {
  return `${link.agent}:${link.path}`;
}

function skillEnabledForLink(_state: SkillState | undefined, _link: Link): boolean {
  return true;
}

function linkedAdapters(links: Link[]): Array<{ link: Link; adapter: AgentAdapter }> {
  const out: Array<{ link: Link; adapter: AgentAdapter }> = [];
  for (const link of links) {
    try {
      out.push({ link, adapter: getAdapter(link.agent) });
    } catch {
      // Ignore stale links for agents that are no longer supported.
    }
  }
  return out;
}

function aliasesCanonicalStore(path: string): boolean {
  if (!existsSync(path) || !existsSync(STORE_SKILLS_DIR)) return false;
  try {
    return realpathSync(path) === realpathSync(STORE_SKILLS_DIR);
  } catch {
    return false;
  }
}

function semanticHash(skill: ParsedSkill): string {
  const normalized = JSON.stringify({
    name: skill.frontmatter.name,
    description: skill.frontmatter.description,
    tier: skill.frontmatter.tier,
    license: skill.frontmatter.license,
    body: skill.body.trim(),
  });
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

/**
 * Merge a skill parsed from a mirror with a canonical's prior frontmatter so
 * that metadata a mirror format can't carry (origin on every adapter today)
 * survives round-trip edits.
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
async function readCanonicalFrontmatter(
  name: string
): Promise<SkillFrontmatter | null> {
  const dir = storeSkillDir(name);
  if (!existsSync(join(dir, "SKILL.md"))) return null;
  try {
    return (await readSkillMd(dir)).frontmatter;
  } catch {
    return null;
  }
}

/**
 * `priorOverride` must be supplied by callers that overwrite the canonical
 * directory before writing (the per-skill-dir copy paths). Reading prior
 * frontmatter off disk after that copy would read back the mirror's own
 * frontmatter, so canonical-only metadata such as tier would be lost.
 */
async function writeCanonicalSkillFile(
  skill: ParsedSkill,
  fallbackOrigin: SkillOrigin,
  priorOverride?: SkillFrontmatter | null
): Promise<void> {
  const dir = storeSkillDir(skill.frontmatter.name);
  await mkdir(dir, { recursive: true });
  const prior =
    priorOverride !== undefined
      ? priorOverride
      : await readCanonicalFrontmatter(skill.frontmatter.name);
  const merged = mergeFrontmatter(skill.frontmatter, prior, fallbackOrigin);
  await writeFile(join(dir, "SKILL.md"), renderSkillMd(merged, skill.body), "utf8");
}

/**
 * Promote a mirror-side edit into canonical.
 *
 * For per-skill-dir layouts the whole mirror directory is copied, not just
 * SKILL.md: a skill can carry references, scripts, and assets, and the user may
 * have added or changed those alongside the SKILL.md edit. Copying only
 * SKILL.md would leave canonical stale, and the mirror would then be
 * overwritten from canonical on the same pass — destroying the added files.
 */
async function promoteMirrorSkillToCanonical(
  name: string,
  link: Link,
  adapter: AgentAdapter,
  fallbackOrigin: SkillOrigin
): Promise<ParsedSkill | null> {
  const mirrorParsed = adapter.readMirrorSkill
    ? await adapter.readMirrorSkill(name, link.path)
    : null;
  if (!mirrorParsed) return null;

  const prior = await readCanonicalFrontmatter(name);
  if (adapter.layout === "per-skill-dir") {
    await copyDirReplace(join(link.path, name), storeSkillDir(name));
  }
  await writeCanonicalSkillFile(mirrorParsed, fallbackOrigin, prior);
  return mirrorParsed;
}

async function replaceCanonicalWithSkill(
  skill: ParsedSkill,
  fallbackOrigin: SkillOrigin
): Promise<void> {
  const dir = storeSkillDir(skill.frontmatter.name);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await writeCanonicalSkillFile(skill, fallbackOrigin);
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

type ImportSource =
  | {
      kind: "canonical";
      name: string;
      parsed: ParsedSkill;
      semantic: string;
      mtime: number;
    }
  | {
      kind: "mirror";
      name: string;
      parsed: ParsedSkill;
      semantic: string;
      mtime: number;
      link: Link;
      adapter: AgentAdapter;
      key: string;
    };

function importSourceLabel(source: ImportSource): string {
  return source.kind === "canonical" ? "canonical" : source.link.agent;
}

async function canonicalMtimeMs(name: string): Promise<number> {
  try {
    const s = await stat(join(storeSkillDir(name), "SKILL.md"));
    return s.mtimeMs;
  } catch {
    return 0;
  }
}

async function copyMirrorSourceToCanonical(
  source: Extract<ImportSource, { kind: "mirror" }>,
  fallbackOrigin: SkillOrigin
): Promise<void> {
  if (source.adapter.layout === "per-skill-dir") {
    const prior = await readCanonicalFrontmatter(source.name);
    await copyDirReplace(join(source.link.path, source.name), storeSkillDir(source.name));
    const copied = await readSkillMd(storeSkillDir(source.name));
    await writeCanonicalSkillFile(copied, fallbackOrigin, prior);
    return;
  }
  await replaceCanonicalWithSkill(source.parsed, fallbackOrigin);
}

async function archiveImportLosers(
  skillName: string,
  losers: ImportSource[],
  winner: ImportSource
): Promise<string> {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveRoot = join(CONFLICTS_DIR, ts, skillName);
  await mkdir(archiveRoot, { recursive: true });
  for (const loser of losers) {
    const label = loser.kind === "canonical" ? "canonical" : loser.link.agent;
    const adapterDir = join(archiveRoot, label);
    await mkdir(adapterDir, { recursive: true });
    await writeFile(
      join(adapterDir, "SKILL.md"),
      renderSkillMd(loser.parsed.frontmatter, loser.parsed.body),
      "utf8"
    );
    const ctx = [
      `# Conflict — ${skillName}`,
      ``,
      `Recorded at: ${new Date().toISOString()}`,
      `This version lost the import conflict (older mtime).`,
      ``,
      `- Loser: ${label}${loser.kind === "mirror" ? ` (${loser.link.path})` : ""}`,
      `- Loser mtime: ${new Date(loser.mtime).toISOString()}`,
      ``,
      `- Winner: ${winner.kind === "canonical" ? "canonical" : `${winner.link.agent} (${winner.link.path})`}`,
      `- Winner mtime: ${new Date(winner.mtime).toISOString()}`,
      ``,
      `Recover by editing the canonical store at ~/.skillset/skills/${skillName}/SKILL.md and merging desired content from this archive.`,
      ``,
    ].join("\n");
    await writeFile(join(adapterDir, "CONTEXT.md"), ctx, "utf8");
  }
  return archiveRoot;
}

/**
 * Import/consolidation pass used before first-contact writes. It groups
 * canonical + mirror versions by skill name. Unknown mirror-only skills are
 * adopted; same-name conflicts choose newest mtime and archive losers.
 */
async function importFromMirrors(
  config: { links: Link[]; ignore?: string[] },
  state: State,
  actions: SyncAction[],
  includeTracked: boolean
): Promise<Set<string>> {
  const groups = new Map<string, ImportSource[]>();
  const touched = new Set<string>();
  const ignored = new Set(config.ignore ?? []);

  const add = (source: ImportSource) => {
    if (!includeTracked && state.skills[source.name]) return;
    const existing = groups.get(source.name) ?? [];
    existing.push(source);
    groups.set(source.name, existing);
  };

  for (const name of await listStoreSkills()) {
    if (!includeTracked && state.skills[name]) continue;
    const parsed = await readSkillMd(storeSkillDir(name)).catch(() => null);
    if (!parsed) continue;
    add({
      kind: "canonical",
      name,
      parsed,
      semantic: semanticHash(parsed),
      mtime: await canonicalMtimeMs(name),
    });
  }

  for (const { link, adapter } of linkedAdapters(config.links)) {
    // Some agents support pointing their native skill root directly at the
    // canonical store. Treat that as a zero-copy mirror, not as an independent
    // edit source, or every canonical write looks like a mirror-side edit.
    if (aliasesCanonicalStore(link.path)) continue;
    if (adapter.layout === "aggregate-file") continue;
    if (!adapter.listMirrorSkills || !adapter.readMirrorSkill) continue;
    const mirrorNames = await adapter.listMirrorSkills(link.path);
    // Skills the agent ships with belong to the vendor. They stay visible and
    // untouched, but must never enter the shared library and be broadcast to
    // every other agent.
    const vendor = new Set(
      adapter.vendorSkills ? await adapter.vendorSkills(link.path) : []
    );
    for (const name of mirrorNames) {
      if (!includeTracked && state.skills[name]) continue;
      // Never pull an ignored or vendor-provided skill into the shared library.
      if (ignored.has(name) || vendor.has(name)) continue;
      if (!skillEnabledForLink(state.skills[name], link)) continue;
      const parsed = await adapter.readMirrorSkill(name, link.path);
      if (!parsed) continue;
      const mtime = adapter.mirrorSkillMtimeMs
        ? (await adapter.mirrorSkillMtimeMs(name, link.path)) ?? 0
        : 0;
      add({
        kind: "mirror",
        name,
        parsed,
        semantic: semanticHash(parsed),
        mtime,
        link,
        adapter,
        key: linkKey(link),
      });
    }
  }

  for (const [name, sources] of groups) {
    const mirrors = sources.filter(
      (s): s is Extract<ImportSource, { kind: "mirror" }> => s.kind === "mirror"
    );
    if (mirrors.length === 0) continue;

    const canonical = sources.find((s) => s.kind === "canonical");
    const uniqueVersions = new Set(sources.map((s) => s.semantic));
    if (!canonical && uniqueVersions.size === 1) {
      const winner = mirrors.sort((a, b) => b.mtime - a.mtime)[0]!;
      await copyMirrorSourceToCanonical(winner, "user-created");
      state.skills[name] = initialSkillState("user-created", { createdBy: "manual" });
      actions.push({ kind: "adopted", skill: name, from: winner.link });
      touched.add(name);
      continue;
    }

    if (uniqueVersions.size <= 1) continue;

    const sorted = [...sources].sort((a, b) => b.mtime - a.mtime);
    const winner = sorted[0]!;
    const losers = sorted.slice(1).filter((s) => s.semantic !== winner.semantic);
    const prior = state.skills[name];
    const origin = prior?.origin ?? "user-created";

    if (winner.kind === "mirror") {
      await copyMirrorSourceToCanonical(winner, origin);
      state.skills[name] = prior
        ? {
            ...prior,
            userEdited: true,
            lastEditedAt: new Date().toISOString(),
          }
        : initialSkillState("user-created", { createdBy: "manual" });
    }

    const archive = await archiveImportLosers(name, losers, winner);
    const conflictState =
      state.skills[name] ??
      initialSkillState(
        winner.parsed.frontmatter.origin ?? "user-created",
        winner.kind === "mirror" ? { createdBy: "manual" } : {}
      );
    conflictState.conflictHistory = [
      ...(conflictState.conflictHistory ?? []),
      {
        at: new Date().toISOString(),
        winnerAdapter: winner.kind === "mirror" ? winner.key : "canonical",
        loserCount: losers.length,
      },
    ];
    state.skills[name] = conflictState;
    touched.add(name);
    if (winner.kind === "mirror") {
      actions.push({
        kind: "conflict",
        skill: name,
        winner: winner.link,
        losers: losers
          .filter((s): s is Extract<ImportSource, { kind: "mirror" }> => s.kind === "mirror")
          .map((s) => s.link),
        archive,
        winnerLabel: winner.link.agent,
        loserLabels: losers.map(importSourceLabel),
        archivedLoserCount: losers.length,
      });
    } else {
      const fallback = mirrors[0]!;
      actions.push({
        kind: "conflict",
        skill: name,
        winner: fallback.link,
        losers: mirrors.slice(1).map((s) => s.link),
        archive,
        winnerLabel: "canonical",
        loserLabels: losers.map(importSourceLabel),
        archivedLoserCount: losers.length,
      });
    }
  }

  return touched;
}

/**
 * One sync pass:
 *   1. Adopt unknown mirror skills into canonical (per-skill layouts only).
 *   2. For each canonical skill + each per-skill mirror: detect user edits
 *      (mirror hash != recorded) → promote mirror → canonical.
 *   3. Push canonical → every per-skill mirror, record new hashes.
 *   4. Rewrite aggregate-file mirrors with the whole canonical set.
 *   5. Prune mirror-side skills that are no longer in canonical.
 */
export async function sync(options: SyncOptions = {}): Promise<SyncReport> {
  const config = await readConfig();
  const state = await readState();
  const actions: SyncAction[] = [];
  const links = linkedAdapters(config.links);
  const operationalLinks = links.filter(({ link }) => !aliasesCanonicalStore(link.path));
  const activeLinkKeys = new Set(operationalLinks.map(({ link }) => linkKey(link)));
  let importTouchedSkills = new Set<string>();

  if (options.importExisting === true || options.adoptUntracked !== false) {
    importTouchedSkills = await importFromMirrors(
      config,
      state,
      actions,
      options.importExisting === true
    );
  }

  const storeSkillNames = await listStoreSkills();
  const storeSkillNameSet = new Set(storeSkillNames);
  const aggregateParsedSkills: ParsedSkill[] = [];
  const failures: SyncReport["failures"] = [];

  for (const name of storeSkillNames) {
   try {
    const canonicalDir = storeSkillDir(name);
    // Single canonical read doubles as validation (throws on malformed SKILL.md)
    // and is reused below unless a promotion/conflict rewrites the file.
    let canonicalParsed = await readSkillMd(canonicalDir);
    // When state lacks this skill (first sync after promote / manual add), seed
    // origin from canonical frontmatter — which is the source of truth. Missing
    // frontmatter origin falls back to "user-created" (safest default).
    let prior = state.skills[name];
    if (!prior) {
      const fmOrigin: SkillOrigin =
        canonicalParsed.frontmatter.origin ?? "user-created";
      prior = initialSkillState(fmOrigin);
    }
    const current: SkillState = {
      ...prior,
      mirrorHashes: Object.fromEntries(
        Object.entries(prior.mirrorHashes).filter(([key]) => {
          if (!activeLinkKeys.has(key)) return false;
          const linked = operationalLinks.find(({ link }) => linkKey(link) === key);
          return linked ? skillEnabledForLink(prior, linked.link) : false;
        })
      ),
    };

    const canonicalHashBefore = prior.canonicalHash;
    // Mirror hashes computed during divergence detection, reused by the write
    // phase below so unchanged mirrors are hashed once instead of rewritten.
    const knownMirrorHashes = new Map<string, string | null>();
    const divergences: Array<{
      link: Link;
      adapter: AgentAdapter;
      key: string;
      hash: string;
      mtime: number;
    }> = [];
    if (!importTouchedSkills.has(name)) {
      for (const { link, adapter } of operationalLinks) {
        if (!skillEnabledForLink(current, link)) continue;
        if (adapter.layout === "aggregate-file") continue;
        if (!adapter.hashMirrorSkill) continue;
        const key = linkKey(link);
        const recorded = prior.mirrorHashes[key];
        const mirrorHash = await adapter.hashMirrorSkill(name, link.path);
        knownMirrorHashes.set(key, mirrorHash);
        if (!mirrorHash || !recorded || mirrorHash === recorded) continue;
        const mtime = adapter.mirrorSkillMtimeMs
          ? (await adapter.mirrorSkillMtimeMs(name, link.path)) ?? 0
          : 0;
        divergences.push({ link, adapter, key, hash: mirrorHash, mtime });
      }
    }

    let canonicalRewritten = false;
    if (divergences.length === 1) {
      const { link, adapter } = divergences[0]!;
      // Preserve the prior origin — a user edit on an auto-created skill does
      // NOT make it user-created; it sets userEdited=true instead.
      const mirrorParsed = await promoteMirrorSkillToCanonical(
        name,
        link,
        adapter,
        prior.origin
      );
      if (mirrorParsed) {
        canonicalRewritten = true;
        current.userEdited = true;
        current.lastEditedAt = new Date().toISOString();
        actions.push({ kind: "promoted", skill: name, from: link });
      }
    } else if (divergences.length >= 2) {
      divergences.sort((a, b) => b.mtime - a.mtime);
      const winner = divergences[0]!;
      const losers = divergences.slice(1);
      const archive = await archiveLosers(name, losers, canonicalHashBefore, winner);
      const winnerParsed = await promoteMirrorSkillToCanonical(
        name,
        winner.link,
        winner.adapter,
        prior.origin
      );
      if (winnerParsed) {
        canonicalRewritten = true;
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
        winnerLabel: winner.link.agent,
        loserLabels: losers.map((l) => l.link.agent),
        archivedLoserCount: losers.length,
      });
    }

    current.canonicalHash = await hashSkillDir(canonicalDir);

    if (canonicalRewritten) {
      canonicalParsed = await readSkillMd(canonicalDir);
    }
    aggregateParsedSkills.push(canonicalParsed);
    for (const { link, adapter } of operationalLinks) {
      if (!skillEnabledForLink(current, link)) continue;
      if (adapter.layout === "aggregate-file") continue;
      if (!adapter.mirrorSkill || !adapter.hashMirrorSkill) continue;
      const key = linkKey(link);
      // Skip the copy when the mirror already matches canonical byte-for-byte —
      // avoids needless disk churn and preserves mirror mtimes, which the
      // newest-mtime-wins conflict resolution depends on.
      const mirrorHash = knownMirrorHashes.has(key)
        ? knownMirrorHashes.get(key)!
        : await adapter.hashMirrorSkill(name, link.path);
      if (mirrorHash && mirrorHash === current.canonicalHash) {
        current.mirrorHashes[key] = mirrorHash;
        continue;
      }
      await adapter.mirrorSkill(canonicalParsed, link.path);
      const newHash = await adapter.hashMirrorSkill(name, link.path);
      if (newHash) current.mirrorHashes[key] = newHash;
      actions.push({ kind: "mirrored", skill: name, to: link });
    }

    state.skills[name] = current;
   } catch (err) {
    // Isolate the failure to this skill so the remaining skills still
    // reconcile and state.json is still written at the end of the pass.
    failures.push({ skill: name, error: err instanceof Error ? err.message : String(err) });
   }
  }

  // Aggregate-file layouts: rewrite once with the whole canonical set.
  for (const { link, adapter } of operationalLinks) {
    if (adapter.layout !== "aggregate-file" || !adapter.mirrorAll) continue;
    const enabledSkills = aggregateParsedSkills.filter((skill) =>
      skillEnabledForLink(state.skills[skill.frontmatter.name], link)
    );
    await adapter.mirrorAll(enabledSkills, link.path);
    for (const skill of enabledSkills) {
      const name = skill.frontmatter.name;
      actions.push({ kind: "mirrored", skill: name, to: link });
    }
  }

  // Prune mirror-side skills no longer in canonical.
  //
  // Only skills skillset actually wrote to this mirror are eligible. A skill the
  // user installed into an agent's own skills dir (by hand, by symlink, or via a
  // third-party installer) has no recorded mirror hash for this link, and
  // deleting it would destroy something skillset never owned. Adoption, not
  // deletion, is how those enter the shared library.
  for (const { link, adapter } of operationalLinks) {
    if (adapter.layout === "aggregate-file") continue;
    if (!adapter.listMirrorSkills || !adapter.removeMirrorSkill) continue;
    const key = linkKey(link);
    const mirrorNames = await adapter.listMirrorSkills(link.path);
    const vendor = new Set(
      adapter.vendorSkills ? await adapter.vendorSkills(link.path) : []
    );
    for (const name of mirrorNames) {
      if (storeSkillNameSet.has(name) && skillEnabledForLink(state.skills[name], link)) continue;
      // A vendor skill is never ours to delete, even if a stale hash claims it.
      if (vendor.has(name)) continue;
      const writtenByUs = state.skills[name]?.mirrorHashes?.[key] !== undefined;
      if (!writtenByUs) continue;
      await adapter.removeMirrorSkill(name, link.path);
      actions.push({ kind: "removed-from-mirror", skill: name, link });
    }
  }

  // Prune state entries for skills no longer in the canonical store.
  for (const name of Object.keys(state.skills)) {
    if (!storeSkillNameSet.has(name)) delete state.skills[name];
  }

  await writeState(state);

  for (const action of actions) {
    if (action.kind === "promoted") {
      await appendHistoryEvent({
        kind: "promoted",
        title: `${action.skill} promoted from ${getAdapter(action.from.agent).displayName}`,
        detail: "A model-side edit became the canonical version and was reconciled everywhere active.",
        skillNames: [action.skill],
        agents: sharedSkillAgents(),
        source: action.from.agent,
      });
    } else if (action.kind === "adopted") {
      await appendHistoryEvent({
        kind: "adopted",
        title: `${action.skill} adopted`,
        detail: `A new skill from ${getAdapter(action.from.agent).displayName} was added to the canonical library.`,
        skillNames: [action.skill],
        agents: sharedSkillAgents(),
        source: action.from.agent,
      });
    } else if (action.kind === "conflict") {
      await appendHistoryEvent({
        kind: "conflict",
        title: `${action.skill} conflict resolved`,
        detail: "The newest model edit won; older versions were archived for recovery.",
        skillNames: [action.skill],
        agents: [...new Set([action.winner.agent, ...action.losers.map((link) => link.agent)])],
        source: "reconciliation",
      });
    }
  }

  return {
    actions,
    skillCount: storeSkillNames.length,
    linkCount: links.length,
    failures,
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
