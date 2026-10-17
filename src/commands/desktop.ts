import matter from "gray-matter";
import pc from "picocolors";
import { renderSkillMd } from "../core/skill.js";
import { createDesktopSnapshot } from "../desktop/snapshot.js";
import { addCommand, readStdin, saveSkillFields } from "./manage.js";
import type { SaveSkillFieldsInput } from "./manage.js";

export async function desktopSnapshotCommand(): Promise<void> {
  console.log(JSON.stringify(await createDesktopSnapshot()));
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value;
}

/** Turn the app's JSON payload into a field update. Exported for tests. */
export function parseDesktopSave(raw: string): SaveSkillFieldsInput {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") throw new Error("expected a JSON object");
  const data = parsed as Record<string, unknown>;
  if (typeof data.name !== "string" || data.name.length === 0) throw new Error("missing name");
  return {
    name: data.name,
    rename: optionalString(data.rename, "rename"),
    description: optionalString(data.description, "description"),
    body: optionalString(data.body, "body"),
  };
}

/**
 * `sks desktop save`: the app sends `{ name, rename?, description?, body? }`
 * on stdin. The CLI renders the frontmatter, so the app never composes YAML.
 */
export async function desktopSaveCommand(): Promise<void> {
  let input: SaveSkillFieldsInput;
  try {
    input = parseDesktopSave((await readStdin()).trim());
  } catch (err) {
    console.error(pc.red(`invalid save payload: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
    return;
  }
  await saveSkillFields(input);
}

export interface SplitSkill {
  name?: string;
  description?: string;
  always?: boolean;
  body: string;
}

/**
 * Split a pasted SKILL.md into the fields the app edits. Lenient: a paste
 * with no frontmatter, or with frontmatter that does not parse, comes back as
 * body only. Exported for tests.
 */
export function splitSkillMarkdown(raw: string): SplitSkill {
  let parsed: { data: Record<string, unknown>; content: string };
  try {
    parsed = matter(raw);
  } catch {
    return { body: raw };
  }
  const { data, content } = parsed;
  const split: SplitSkill = { body: content.trim() };
  if (typeof data.name === "string" && data.name.trim()) split.name = data.name.trim();
  if (typeof data.description === "string" && data.description.trim()) {
    split.description = data.description.trim();
  }
  if (data.always === true) split.always = true;
  return split;
}

/** `sks desktop parse`: a pasted SKILL.md on stdin, its fields as JSON on stdout. */
export async function desktopParseCommand(): Promise<void> {
  console.log(JSON.stringify(splitSkillMarkdown(await readStdin())));
}

export interface CreateSkillInput {
  name: string;
  description: string;
  body: string;
  always: boolean;
}

/** Turn the app's JSON payload into a new skill. Exported for tests. */
export function parseDesktopCreate(raw: string): CreateSkillInput {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") throw new Error("expected a JSON object");
  const data = parsed as Record<string, unknown>;
  if (typeof data.name !== "string" || data.name.length === 0) throw new Error("missing name");
  const description = optionalString(data.description, "description")?.trim();
  if (!description) throw new Error("missing description");
  if (data.always !== undefined && typeof data.always !== "boolean") {
    throw new Error("always must be a boolean");
  }
  return {
    name: data.name,
    description,
    body: optionalString(data.body, "body") ?? "",
    always: data.always === true,
  };
}

/**
 * `sks desktop create`: the app sends `{ name, description, body, always? }`
 * on stdin. The CLI renders the frontmatter and installs the skill the same
 * way `sks add` does.
 */
export async function desktopCreateCommand(): Promise<void> {
  let content: string;
  let always: boolean;
  try {
    const input = parseDesktopCreate((await readStdin()).trim());
    always = input.always;
    content = renderSkillMd({ name: input.name, description: input.description, always }, input.body);
  } catch (err) {
    console.error(pc.red(`invalid skill: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
    return;
  }
  await addCommand(undefined, { content, always });
}
