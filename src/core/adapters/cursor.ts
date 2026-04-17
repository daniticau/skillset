/**
 * Cursor adapter — mirrors skills to ~/.cursor/rules/<name>.mdc, one file per
 * skill. Each file carries a small YAML frontmatter block (description, globs,
 * alwaysApply) followed by the canonical skill body.
 *
 * v1: user-global location only. Project-level .cursor/rules/ is out of scope.
 */

import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import matter from "gray-matter";
import type { AgentAdapter } from "./types.js";
import type { ParsedSkill } from "../skill.js";

const DEFAULT_CURSOR_RULES_DIR = join(homedir(), ".cursor", "rules");

function filePath(root: string, name: string): string {
  return join(root, `${name}.mdc`);
}

/**
 * Emit a Cursor-shaped frontmatter block. Key order is deliberate — some
 * Cursor versions are particular about which keys appear where.
 */
function renderMdc(skill: ParsedSkill): string {
  const description = skill.frontmatter.description.replace(/\r?\n/g, " ");
  const lines = [
    "---",
    `description: ${JSON.stringify(description)}`,
    `globs: []`,
    `alwaysApply: false`,
    `skillset-name: ${skill.frontmatter.name}`,
    "---",
    "",
  ];
  const body = skill.body.trim();
  return lines.join("\n") + body + "\n";
}

/** Parse an .mdc file back into a ParsedSkill. The canonical name comes from
 *  `skillset-name` if present, else the filename stem. */
function parseMdc(content: string, fallbackName: string): ParsedSkill | null {
  try {
    const parsed = matter(content);
    const data = parsed.data as Record<string, unknown>;
    const name =
      typeof data["skillset-name"] === "string" && data["skillset-name"]
        ? (data["skillset-name"] as string)
        : fallbackName;
    const description =
      typeof data.description === "string" && data.description
        ? (data.description as string)
        : "Cursor rule";
    return {
      frontmatter: { name, description },
      body: parsed.content.trim(),
    };
  } catch {
    return null;
  }
}

export const cursorAdapter: AgentAdapter = {
  kind: "cursor",
  defaultPath: DEFAULT_CURSOR_RULES_DIR,
  displayName: "Cursor",
  layout: "per-skill-file",

  async detect() {
    const cursorHome = join(homedir(), ".cursor");
    if (!existsSync(cursorHome)) return null;
    return { path: DEFAULT_CURSOR_RULES_DIR };
  },

  async mirrorSkill(skill: ParsedSkill, targetRoot: string): Promise<string> {
    await mkdir(targetRoot, { recursive: true });
    const path = filePath(targetRoot, skill.frontmatter.name);
    await writeFile(path, renderMdc(skill), "utf8");
    return path;
  },

  async hashMirrorSkill(name: string, targetRoot: string): Promise<string | null> {
    const path = filePath(targetRoot, name);
    if (!existsSync(path)) return null;
    const raw = await readFile(path, "utf8");
    return createHash("sha256").update(raw).digest("hex").slice(0, 16);
  },

  async mirrorSkillMtimeMs(name: string, targetRoot: string): Promise<number | null> {
    const path = filePath(targetRoot, name);
    if (!existsSync(path)) return null;
    const s = await stat(path);
    return s.mtimeMs;
  },

  async readMirrorSkill(name: string, targetRoot: string): Promise<ParsedSkill | null> {
    const path = filePath(targetRoot, name);
    if (!existsSync(path)) return null;
    const raw = await readFile(path, "utf8");
    return parseMdc(raw, name);
  },

  async listMirrorSkills(targetRoot: string): Promise<string[]> {
    if (!existsSync(targetRoot)) return [];
    const entries = await readdir(targetRoot, { withFileTypes: true });
    const out: string[] = [];
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".mdc")) continue;
      const stem = e.name.slice(0, -".mdc".length);
      // Try to pull canonical name from frontmatter; fall back to stem.
      try {
        const raw = await readFile(join(targetRoot, e.name), "utf8");
        const parsed = parseMdc(raw, stem);
        if (parsed) {
          out.push(parsed.frontmatter.name);
          continue;
        }
      } catch {
        // ignore
      }
      out.push(stem);
    }
    return out.sort();
  },

  async removeMirrorSkill(name: string, targetRoot: string): Promise<void> {
    const path = filePath(targetRoot, name);
    if (existsSync(path)) await rm(path, { force: true });
  },
};
