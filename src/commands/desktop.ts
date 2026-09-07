import pc from "picocolors";
import { createDesktopSnapshot } from "../desktop/snapshot.js";
import { readStdin, saveSkillFields } from "./manage.js";
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
