import type { AgentKind } from "../config.js";
import type { ParsedSkill } from "../skill.js";

/**
 * How an agent stores its skills on disk.
 *   per-skill-dir   — one directory per skill (Claude Code, Codex)
 *   per-skill-file  — one file per skill
 *   aggregate-file  — all skills in one managed file
 */
export type MirrorLayout = "per-skill-dir" | "per-skill-file" | "aggregate-file";

export interface AgentAdapter {
  kind: AgentKind;
  defaultPath: string;
  displayName: string;
  layout: MirrorLayout;

  /**
   * Heuristic presence check: does the user appear to have this agent installed?
   * Returns the concrete target path if detected, null otherwise.
   */
  detect(): Promise<{ path: string } | null>;

  // Per-skill layouts (per-skill-dir, per-skill-file):
  /** Write one skill into the mirror. Returns a path or identifier for logging. */
  mirrorSkill?(skill: ParsedSkill, targetRoot: string): Promise<string>;
  /** Hash the mirror's representation of this skill (for user-edit detection). */
  hashMirrorSkill?(name: string, targetRoot: string): Promise<string | null>;
  /**
   * Last-modified time (ms since epoch) of the mirror's content for this skill.
   * Used as a tiebreaker when multiple mirrors of the same skill diverge from
   * canonical (and from each other) — newest edit wins.
   */
  mirrorSkillMtimeMs?(name: string, targetRoot: string): Promise<number | null>;
  /** Read a mirror-side skill back as a ParsedSkill (for promotion / adoption). */
  readMirrorSkill?(name: string, targetRoot: string): Promise<ParsedSkill | null>;
  /** List skill names present in the mirror. */
  listMirrorSkills?(targetRoot: string): Promise<string[]>;
  /**
   * Skills that ship with the agent itself.
   *
   * These belong to the vendor, not the user: skillset surfaces them so the
   * user can see what is already installed, but never adopts them into the
   * shared library and never deletes them.
   */
  vendorSkills?(targetRoot: string): Promise<string[]>;
  /** Delete a skill from the mirror (for prune-on-canonical-delete). */
  removeMirrorSkill?(name: string, targetRoot: string): Promise<void>;

  // Aggregate-file layout:
  /** Rewrite the aggregate file with all current canonical skills. */
  mirrorAll?(skills: ParsedSkill[], targetRoot: string): Promise<string>;
  /** Hash the aggregate file's managed region (for drift detection). */
  hashAggregate?(targetRoot: string): Promise<string | null>;
}
