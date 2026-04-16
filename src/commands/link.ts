import pc from "picocolors";
import type { AgentKind } from "../core/config.js";
import { readConfig, writeConfig } from "../core/config.js";
import { getAdapter, supportedAgents } from "../core/adapters/index.js";

export async function linkCommand(
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
    console.log(pc.dim(`• ${adapter.displayName} already linked at ${path}`));
    return;
  }

  config.links.push({ agent, path });
  await writeConfig(config);
  console.log(pc.green(`✓ linked ${adapter.displayName} mirror at ${path}`));
}

export async function unlinkCommand(rawAgent: string, options: { path?: string }): Promise<void> {
  const agent = rawAgent as AgentKind;
  const config = await readConfig();
  const before = config.links.length;
  config.links = config.links.filter(
    (l) => !(l.agent === agent && (!options.path || l.path === options.path))
  );
  await writeConfig(config);
  const removed = before - config.links.length;
  console.log(
    removed > 0
      ? pc.green(`✓ unlinked ${removed} mirror(s) for ${agent}`)
      : pc.dim(`• no matching link for ${agent}`)
  );
}
