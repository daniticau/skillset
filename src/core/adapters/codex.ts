/**
 * Codex adapter — aggregates all canonical skills into ~/.codex/AGENTS.md,
 * inside a fenced managed region. User content above/below the fence is
 * preserved across syncs.
 *
 *   ...your own content...
 *   <!-- skillset:begin — do not edit this block -->
 *   ## skill-one
 *   ... body ...
 *
 *   ## skill-two
 *   ... body ...
 *   <!-- skillset:end -->
 *   ...your own content...
 *
 * v1: user-global file only. Per-project AGENTS.md is deferred.
 */

import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import type { AgentAdapter } from "./types.js";
import type { ParsedSkill } from "../skill.js";

const DEFAULT_CODEX_AGENTS_FILE = join(homedir(), ".codex", "AGENTS.md");

const BEGIN_MARKER = "<!-- skillset:begin — do not edit this block -->";
const END_MARKER = "<!-- skillset:end -->";

function renderManagedBlock(skills: ParsedSkill[]): string {
  const sorted = [...skills].sort((a, b) =>
    a.frontmatter.name.localeCompare(b.frontmatter.name)
  );
  const sections = sorted.map((s) => {
    const body = s.body.trim();
    return `## ${s.frontmatter.name}\n\n${body}`;
  });
  return [
    BEGIN_MARKER,
    "",
    "# Skills (managed by skillset)",
    "",
    sections.join("\n\n"),
    "",
    END_MARKER,
  ].join("\n");
}

/** Insert or replace the managed region inside `existing`. */
function rewriteManagedBlock(existing: string, block: string): string {
  const beginIdx = existing.indexOf(BEGIN_MARKER);
  const endIdx = existing.indexOf(END_MARKER);

  if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) {
    // No markers present — append the block at EOF.
    const trimmed = existing.replace(/\s+$/, "");
    const prefix = trimmed.length === 0 ? "" : trimmed + "\n\n";
    return prefix + block + "\n";
  }
  const before = existing.slice(0, beginIdx).replace(/\s+$/, "");
  const after = existing.slice(endIdx + END_MARKER.length).replace(/^\s+/, "");
  const prefix = before.length === 0 ? "" : before + "\n\n";
  const suffix = after.length === 0 ? "" : "\n\n" + after;
  return prefix + block + suffix + (suffix.endsWith("\n") ? "" : "\n");
}

export const codexAdapter: AgentAdapter = {
  kind: "codex",
  defaultPath: DEFAULT_CODEX_AGENTS_FILE,
  displayName: "Codex",
  layout: "aggregate-file",

  async detect() {
    const codexHome = join(homedir(), ".codex");
    if (!existsSync(codexHome)) return null;
    return { path: DEFAULT_CODEX_AGENTS_FILE };
  },

  async mirrorAll(skills: ParsedSkill[], targetPath: string): Promise<string> {
    await mkdir(dirname(targetPath), { recursive: true });
    const existing = existsSync(targetPath) ? await readFile(targetPath, "utf8") : "";
    const block = renderManagedBlock(skills);
    const next = rewriteManagedBlock(existing, block);
    await writeFile(targetPath, next, "utf8");
    return targetPath;
  },

  async hashAggregate(targetPath: string): Promise<string | null> {
    if (!existsSync(targetPath)) return null;
    const raw = await readFile(targetPath, "utf8");
    const beginIdx = raw.indexOf(BEGIN_MARKER);
    const endIdx = raw.indexOf(END_MARKER);
    if (beginIdx === -1 || endIdx === -1) return null;
    const region = raw.slice(beginIdx, endIdx + END_MARKER.length);
    return createHash("sha256").update(region).digest("hex").slice(0, 16);
  },
};
