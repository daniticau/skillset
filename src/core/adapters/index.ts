import type { AgentKind } from "../config.js";
import type { AgentAdapter } from "./types.js";
import { claudeCodeAdapter } from "./claude-code.js";
import { codexAdapter } from "./codex.js";

const ADAPTERS: Record<AgentKind, AgentAdapter | undefined> = {
  "claude-code": claudeCodeAdapter,
  codex: codexAdapter,
  copilot: undefined,
};

export function getAdapter(kind: AgentKind): AgentAdapter {
  const adapter = ADAPTERS[kind];
  if (!adapter) {
    throw new Error(
      `Adapter for "${kind}" is not implemented yet.`
    );
  }
  return adapter;
}

export function supportedAgents(): AgentKind[] {
  return (Object.keys(ADAPTERS) as AgentKind[]).filter((k) => ADAPTERS[k]);
}

export function defaultAutoLinkAgents(): AgentKind[] {
  return supportedAgents();
}

export type { AgentAdapter } from "./types.js";
