import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readConfig, readState, writeState } from "./config.js";
import type { Link, SkillState, State } from "./config.js";
import { hashSkillDir, readSkillMd } from "./skill.js";
import type { ParsedSkill } from "./skill.js";
import {
  listStoreSkills,
  storeSkillDir,
  validateStoreSkill,
} from "./store.js";
import { getAdapter } from "./adapters/index.js";
import type { AgentAdapter } from "./adapters/index.js";

export type SyncAction =
  | { kind: "promoted"; skill: string; from: Link }
  | { kind: "mirrored"; skill: string; to: Link }
  | { kind: "adopted"; skill: string; from: Link }
  | { kind: "conflict"; skill: string; link: Link }
  | { kind: "removed-from-mirror"; skill: string; link: Link };

export interface SyncReport {
  actions: SyncAction[];
  skillCount: number;
  linkCount: number;
}

function linkKey(link: Link): string {
  return `${link.agent}:${link.path}`;
}

function initialSkillState(): SkillState {
  return { canonicalHash: "", mirrorHashes: {}, userModified: false };
}

/**
 * Write a ParsedSkill back to the canonical store (after promotion or adoption
 * from a non-Claude-Code mirror). Only writes SKILL.md; doesn't touch other
 * files that may coexist in the canonical dir for per-dir layouts.
 */
async function writeCanonicalSkillFile(skill: ParsedSkill): Promise<void> {
  const dir = storeSkillDir(skill.frontmatter.name);
  await mkdir(dir, { recursive: true });
  const fm = [
    "---",
    `name: ${skill.frontmatter.name}`,
    `description: ${JSON.stringify(skill.frontmatter.description)}`,
  ];
  if (skill.frontmatter.license) {
    fm.push(`license: ${JSON.stringify(skill.frontmatter.license)}`);
  }
  fm.push("---", "");
  const body = skill.body.trim();
  await writeFile(join(dir, "SKILL.md"), fm.join("\n") + body + "\n", "utf8");
}

/** Adoption pass: any skill that exists in a per-skill mirror but not in the
 *  canonical store gets promoted into canonical.  Aggregate-file mirrors are
 *  skipped — v1 doesn't support user-edit promotion from a shared file. */
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
      await writeCanonicalSkillFile(parsed);
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

  // Per-skill layouts: canonical → each mirror, with user-edit promotion.
  for (const name of storeSkillNames) {
    await validateStoreSkill(name);
    const canonicalDir = storeSkillDir(name);
    const prior = state.skills[name] ?? initialSkillState();
    const current: SkillState = {
      ...prior,
      mirrorHashes: { ...prior.mirrorHashes },
    };

    // Detect and promote user edits from per-skill mirrors.
    for (const link of config.links) {
      const adapter = getAdapter(link.agent);
      if (adapter.layout === "aggregate-file") continue;
      if (!adapter.hashMirrorSkill) continue;
      const key = linkKey(link);
      const recorded = prior.mirrorHashes[key];
      const mirrorHash = await adapter.hashMirrorSkill(name, link.path);
      if (mirrorHash && recorded && mirrorHash !== recorded) {
        const mirrorParsed = adapter.readMirrorSkill
          ? await adapter.readMirrorSkill(name, link.path)
          : null;
        if (mirrorParsed) {
          await writeCanonicalSkillFile(mirrorParsed);
          current.userModified = true;
          actions.push({ kind: "promoted", skill: name, from: link });
        }
      }
    }

    // Recompute canonical hash after any promotion.
    current.canonicalHash = await hashSkillDir(canonicalDir);

    // Push canonical → per-skill mirrors.
    const freshParsed = await readSkillMd(canonicalDir);
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
  const allParsed: ParsedSkill[] = [];
  for (const name of storeSkillNames) {
    try {
      allParsed.push(await readSkillMd(storeSkillDir(name)));
    } catch {
      // skip malformed — already warned in per-skill pass
    }
  }
  for (const link of config.links) {
    const adapter = getAdapter(link.agent);
    if (adapter.layout !== "aggregate-file" || !adapter.mirrorAll) continue;
    await adapter.mirrorAll(allParsed, link.path);
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
      if (storeSkillNames.includes(name)) continue;
      await adapter.removeMirrorSkill(name, link.path);
      actions.push({ kind: "removed-from-mirror", skill: name, link });
    }
  }

  // Prune state entries for skills no longer in the canonical store.
  for (const name of Object.keys(state.skills)) {
    if (!storeSkillNames.includes(name)) delete state.skills[name];
  }

  await writeState(state);

  return {
    actions,
    skillCount: storeSkillNames.length,
    linkCount: config.links.length,
  };
}

export async function status(): Promise<{
  skills: Array<{ name: string; userModified: boolean; mirrors: string[] }>;
  links: Array<Link & { layout: AgentAdapter["layout"] }>;
}> {
  const config = await readConfig();
  const state = await readState();
  const storeSkillNames = await listStoreSkills();
  return {
    skills: storeSkillNames.map((name) => {
      const s: State["skills"][string] | undefined = state.skills[name];
      return {
        name,
        userModified: s?.userModified ?? false,
        mirrors: Object.keys(s?.mirrorHashes ?? {}),
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
