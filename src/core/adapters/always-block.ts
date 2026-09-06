/**
 * Always-on block: the part of an agent's global instructions file that
 * skillset owns.
 *
 * A skill normally loads on demand. The agent sees its description and pulls
 * the body in when it decides the skill applies. That decision can miss. A rule
 * that must hold in every session ("never do X") belongs in the file the agent
 * reads unconditionally (CLAUDE.md, AGENTS.md), not behind a trigger. Skills
 * marked `always: true` are rendered into one managed block there on every
 * sync.
 *
 * Everything outside the markers belongs to the user and is preserved byte for
 * byte. Everything inside is derived from canonical and rewritten each time.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import type { ParsedSkill } from "../skill.js";

export const ALWAYS_START = "<!-- skillset:always:start -->";
export const ALWAYS_END = "<!-- skillset:always:end -->";
const NOTICE =
  "<!-- Managed by skillset. Do not edit this block. Change a rule with `sks edit <name>`; drop one with `sks always <name> --off`. -->";

/** Push every heading down one level so skill bodies nest under their title. */
function demoteHeadings(body: string): string {
  let inFence = false;
  return body
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) inFence = !inFence;
      if (inFence) return line;
      return /^#{1,5}\s/.test(line) ? `#${line}` : line;
    })
    .join("\n");
}

/** Use the body's leading H1 as the block title, or fall back to the name. */
function splitTitle(skill: ParsedSkill): { title: string; body: string } {
  const lines = skill.body.trimStart().split("\n");
  const first = lines[0] ?? "";
  const h1 = first.match(/^#\s+(.+?)\s*$/);
  if (h1) {
    return { title: h1[1]!, body: lines.slice(1).join("\n") };
  }
  return { title: skill.frontmatter.name, body: skill.body };
}

export function renderAlwaysBlock(skills: ParsedSkill[]): string {
  if (skills.length === 0) return "";
  const sorted = [...skills].sort((a, b) =>
    a.frontmatter.name.localeCompare(b.frontmatter.name)
  );
  const parts: string[] = [ALWAYS_START, NOTICE, ""];
  for (const skill of sorted) {
    const { title, body } = splitTitle(skill);
    parts.push(`## ${title}`, `<!-- skill: ${skill.frontmatter.name} -->`, "");
    parts.push(demoteHeadings(body).trim(), "");
  }
  parts.push(ALWAYS_END);
  return parts.join("\n") + "\n";
}

/** The current managed region of a file, markers included, or null if absent. */
export function readAlwaysBlock(text: string): string | null {
  const start = text.indexOf(ALWAYS_START);
  if (start < 0) return null;
  const end = text.indexOf(ALWAYS_END, start);
  if (end < 0) return null;
  return text.slice(start, end + ALWAYS_END.length);
}

/**
 * Return `existing` with its managed region replaced by `block`.
 *
 * An empty `block` removes the region. A file with no region gets the block
 * appended after one blank line. User text is never touched.
 */
export function spliceAlwaysBlock(existing: string, block: string): string {
  const start = existing.indexOf(ALWAYS_START);
  const end = start >= 0 ? existing.indexOf(ALWAYS_END, start) : -1;
  if (start >= 0 && end >= 0) {
    const before = existing.slice(0, start);
    const after = existing.slice(end + ALWAYS_END.length);
    if (!block) {
      const joined = `${before.trimEnd()}\n\n${after.trimStart()}`.trim();
      return joined ? `${joined}\n` : "";
    }
    return before + block.trimEnd() + after;
  }
  if (!block) return existing;
  if (!existing.trim()) return block;
  return `${existing.trimEnd()}\n\n${block}`;
}

export async function writeAlwaysBlock(
  file: string,
  skills: ParsedSkill[]
): Promise<{ changed: boolean; removed: boolean }> {
  const block = renderAlwaysBlock(skills);
  const existing = existsSync(file) ? await readFile(file, "utf8") : "";
  if (!existing && !block) return { changed: false, removed: false };
  const next = spliceAlwaysBlock(existing, block);
  if (next === existing) return { changed: false, removed: false };
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, next, "utf8");
  return { changed: true, removed: !block };
}

export type AlwaysBlockState = "ok" | "stale" | "missing" | "none";

/**
 * Compare what the file holds with what canonical would render.
 *   ok       block present and current
 *   stale    block present but differs (edited by hand, or canonical moved on)
 *   missing  always-on skills exist but the file has no block
 *   none     nothing to write and nothing written
 */
export async function alwaysBlockState(
  file: string,
  skills: ParsedSkill[]
): Promise<AlwaysBlockState> {
  const rendered = renderAlwaysBlock(skills).trimEnd();
  const existing = existsSync(file) ? readAlwaysBlock(await readFile(file, "utf8")) : null;
  if (!rendered) return existing ? "stale" : "none";
  if (!existing) return "missing";
  return existing.trimEnd() === rendered ? "ok" : "stale";
}

export function hashAlwaysBlock(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}
