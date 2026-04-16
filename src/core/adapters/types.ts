import type { AgentKind } from "../config.js";

export interface AgentAdapter {
  kind: AgentKind;
  defaultPath: string;
  displayName: string;
  // Heuristic presence check: does the user appear to have this agent installed?
  // Used by `init` for auto-linking. May have false negatives (returns a concrete path
  // if detected, null otherwise — path can override defaultPath if the agent lives
  // somewhere non-standard).
  detect: () => Promise<{ path: string } | null>;
}
