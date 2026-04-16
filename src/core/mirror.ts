import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readConfig, readState, writeState } from "./config.js";
import type { Link, SkillState, State } from "./config.js";
import { hashSkillDir, listSkillDirs } from "./skill.js";
import {
  copyDirReplace,
  listStoreSkills,
  storeSkillDir,
  validateStoreSkill,
} from "./store.js";

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

function mirrorSkillDir(link: Link, name: string): string {
  return join(link.path, name);
}

function linkKey(link: Link): string {
  return `${link.agent}:${link.path}`;
}

function initialSkillState(): SkillState {
  return { canonicalHash: "", mirrorHashes: {}, userModified: false };
}

// sync is the core operation. for each skill, for each mirror:
//   - if mirror missing -> write canonical to mirror
//   - if mirror present and unchanged since last sync -> overwrite with canonical
//   - if mirror changed since last sync (user edited) -> promote mirror to canonical,
//     mark userModified, then propagate to other mirrors
// new skills only present in a mirror are adopted into the canonical store.
export async function sync(): Promise<SyncReport> {
  const config = await readConfig();
  const state = await readState();
  const actions: SyncAction[] = [];

  for (const link of config.links) {
    await mkdir(link.path, { recursive: true });
    const mirrorDirs = await listSkillDirs(link.path);
    for (const dir of mirrorDirs) {
      const name = dir.split(/[/\\]/).pop()!;
      const known = state.skills[name];
      if (!known) {
        await copyDirReplace(dir, storeSkillDir(name));
        actions.push({ kind: "adopted", skill: name, from: link });
      }
    }
  }

  const storeSkillNames = await listStoreSkills();

  for (const name of storeSkillNames) {
    await validateStoreSkill(name);
    const canonicalDir = storeSkillDir(name);
    const prior = state.skills[name] ?? initialSkillState();
    let current: SkillState = { ...prior, mirrorHashes: { ...prior.mirrorHashes } };

    for (const link of config.links) {
      const key = linkKey(link);
      const mirrorDir = mirrorSkillDir(link, name);
      const recorded = prior.mirrorHashes[key];

      if (existsSync(join(mirrorDir, "SKILL.md"))) {
        const mirrorHash = await hashSkillDir(mirrorDir);
        if (recorded && mirrorHash !== recorded) {
          // user edited the mirror directly — promote to canonical
          await copyDirReplace(mirrorDir, canonicalDir);
          current.userModified = true;
          actions.push({ kind: "promoted", skill: name, from: link });
        }
      }
    }

    // recompute canonical hash after any promotion
    current.canonicalHash = await hashSkillDir(canonicalDir);

    // push canonical -> every mirror
    for (const link of config.links) {
      const key = linkKey(link);
      const mirrorDir = mirrorSkillDir(link, name);
      await copyDirReplace(canonicalDir, mirrorDir);
      const mirrorHash = await hashSkillDir(mirrorDir);
      current.mirrorHashes[key] = mirrorHash;
      actions.push({ kind: "mirrored", skill: name, to: link });
    }

    state.skills[name] = current;
  }

  // prune state entries for skills no longer in the store
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
  links: Link[];
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
    links: config.links,
  };
}
