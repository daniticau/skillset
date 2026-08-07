import pc from "picocolors";
import type { AgentKind } from "../core/config.js";
import { readConfig, writeConfig } from "../core/config.js";
import { getAdapter, supportedAgents } from "../core/adapters/index.js";
import { sync } from "../core/mirror.js";
import { printSyncReport } from "./sync.js";
import { appendHistoryEvent } from "../core/history.js";

export async function connectCommand(
  rawAgent: string,
  options: { path?: string }
): Promise<void> {
  const supported = supportedAgents();
  const agent = rawAgent as AgentKind;
  if (!supported.includes(agent)) {
    console.error(
      pc.red(`unsupported agent "${rawAgent}". supported: ${supported.join(", ")}`)
    );
    process.exitCode = 1;
    return;
  }

  const adapter = getAdapter(agent);
  const path = options.path ?? adapter.defaultPath;

  const config = await readConfig();
  const existingIndex = config.links.findIndex(
    (l) => l.agent === agent && l.path === path
  );
  if (existingIndex >= 0) {
    console.log(pc.dim(`• ${adapter.displayName} already connected at ${path}`));
    return;
  }

  config.links.push({ agent, path });
  await writeConfig(config);
  console.log(pc.green(`✓ connected ${adapter.displayName} mirror at ${path}`));
  printSyncReport(await sync({ importExisting: true }));
  await appendHistoryEvent({
    kind: "connection",
    title: `${adapter.displayName} connected`,
    detail: `The model library at ${path} is now synchronized with Skillset.`,
    skillNames: [],
    agents: [agent],
    source: "connection",
  });
}

export async function disconnectCommand(rawAgent: string, options: { path?: string }): Promise<void> {
  const agent = rawAgent as AgentKind;
  const config = await readConfig();
  const before = config.links.length;
  config.links = config.links.filter(
    (l) => !(l.agent === agent && (!options.path || l.path === options.path))
  );
  await writeConfig(config);
  const removed = before - config.links.length;
  if (removed === 0) {
    console.log(pc.dim(`• no matching connection for ${agent}`));
    return;
  }
  console.log(pc.green(`✓ disconnected ${removed} mirror(s) for ${agent}`));
  printSyncReport(await sync());
  await appendHistoryEvent({
    kind: "connection",
    title: `${getAdapter(agent).displayName} disconnected`,
    detail: "Skillset stopped synchronizing this model library. Existing files were left in place.",
    skillNames: [],
    agents: [agent],
    source: "connection",
  });
}

export const linkCommand = connectCommand;
export const unlinkCommand = disconnectCommand;
