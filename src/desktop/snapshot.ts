import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readConfig, readState } from "../core/config.js";
import { getAdapter, supportedAgents } from "../core/adapters/index.js";
import { listStoreSkills, storeSkillDir } from "../core/store.js";
import { readSkillMd } from "../core/skill.js";
import { STORE_ROOT } from "../core/paths.js";
import { categorizeSkill } from "../commands/catalog.js";
import { readHistoryEvents } from "../core/history.js";
import type { AgentKind } from "../core/config.js";

export interface DesktopConnection {
  id: string;
  agent: string;
  name: string;
  path: string;
  configured: boolean;
  status: "live" | "attention" | "offline";
  skillCount: number;
  expectedSkillCount: number;
}

export interface DesktopSkill {
  id: string;
  name: string;
  description: string;
  body: string;
  markdown: string;
  origin: string;
  userEdited: boolean;
  category: string;
}

export interface DesktopHistoryEvent {
  id: string;
  createdAt: string;
  kind: string;
  title: string;
  detail: string;
  skillNames: string[];
  agents: AgentKind[];
  source: string;
}

export async function createDesktopSnapshot(): Promise<Record<string, unknown>> {
  const [config, state, names, storedHistory] = await Promise.all([
    readConfig(),
    readState(),
    listStoreSkills(),
    readHistoryEvents(),
  ]);
  const skills: DesktopSkill[] = [];
  for (const name of names) {
    const parsed = await readSkillMd(storeSkillDir(name));
    const markdown = (await readFile(join(storeSkillDir(name), "SKILL.md"), "utf8"))
      .replace(/^tier:\s*(?:high|medium|low)\s*\n/m, "");
    const skillState = state.skills[name];
    skills.push({
      id: name,
      name,
      description: parsed.frontmatter.description,
      body: parsed.body.trim(),
      markdown,
      origin: parsed.frontmatter.origin ?? skillState?.origin ?? "user-created",
      userEdited: skillState?.userEdited ?? false,
      category: categorizeSkill(parsed.frontmatter),
    });
  }

  const connections: DesktopConnection[] = [];
  for (const link of config.links) {
    const adapter = getAdapter(link.agent);
    const expectedSkillCount = names.length;
    let skillCount = 0;
    if (existsSync(link.path) && adapter.listMirrorSkills) {
      // Ignored skills are the user's own, deliberately kept out of the shared
      // library. Counting them makes a healthy mirror look like it has drifted.
      const ignored = new Set(config.ignore ?? []);
      const vendor = new Set(
        adapter.vendorSkills ? await adapter.vendorSkills(link.path) : []
      );
      skillCount = (await adapter.listMirrorSkills(link.path)).filter(
        (name) => !ignored.has(name) && !vendor.has(name)
      ).length;
    }
    connections.push({
      id: `${link.agent}:${link.path}`,
      agent: link.agent,
      name: adapter.displayName,
      path: link.path,
      configured: true,
      status: !existsSync(link.path)
        ? "offline"
        : skillCount === expectedSkillCount
          ? "live"
          : "attention",
      skillCount,
      expectedSkillCount,
    });
  }

  for (const agent of supportedAgents()) {
    if (config.links.some((link) => link.agent === agent)) continue;
    const adapter = getAdapter(agent);
    const expectedSkillCount = names.length;
    connections.push({
      id: `${agent}:${adapter.defaultPath}`,
      agent,
      name: adapter.displayName,
      path: adapter.defaultPath,
      configured: false,
      status: "offline",
      skillCount: 0,
      expectedSkillCount,
    });
  }

  const history = [...storedHistory]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 500);

  return {
    generatedAt: new Date().toISOString(),
    storePath: STORE_ROOT,
    connections,
    skills: skills.sort((a, b) => a.name.localeCompare(b.name)),
    history,
  };
}
