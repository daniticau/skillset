import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rename as renameDir, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import pc from "picocolors";
import {
  initialSkillState,
  readConfig,
  readState,
  writeConfig,
  writeState,
} from "../core/config.js";
import {
  hashSkillDir,
  parseSkillMd,
  readSkillMd,
  renderSkillMd,
  validateSkillName,
} from "../core/skill.js";
import { storeSkillDir } from "../core/store.js";
import { getAdapter } from "../core/adapters/index.js";
import { syncCommand } from "./sync.js";
import { appendHistoryEvent, sharedSkillAgents } from "../core/history.js";
import { RemoteSourceError, isRemoteSource, resolveRemoteSkill } from "../core/remote.js";
import { buildCommand } from "./build.js";

function editorCommand(): string | undefined {
  return process.env.VISUAL || process.env.EDITOR;
}

async function runEditor(command: string, file: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, [file], { stdio: "inherit", shell: true });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function markUserEdited(name: string): Promise<void> {
  const state = await readState();
  const prior = state.skills[name] ?? initialSkillState("user-created", { createdBy: "manual" });
  state.skills[name] = {
    ...prior,
    userEdited: true,
    lastEditedAt: new Date().toISOString(),
  };
  await writeState(state);
}

async function markManagedEdited(name: string): Promise<void> {
  const state = await readState();
  const prior = state.skills[name] ?? initialSkillState("auto-created", { createdBy: "agent" });
  state.skills[name] = {
    ...prior,
    lastEditedAt: new Date().toISOString(),
  };
  await writeState(state);
}

const IGNORED_SOURCE_PARTS = new Set([".git", "node_modules", "__pycache__", ".DS_Store"]);

async function copySkillSource(sourceDir: string, dest: string): Promise<void> {
  if (existsSync(dest)) await rm(dest, { recursive: true, force: true });
  await cp(sourceDir, dest, {
    recursive: true,
    filter: (source) => !source.split(/[\\/]/).some((part) => IGNORED_SOURCE_PARTS.has(part)),
  });
}

interface FinishEditOptions {
  /** Agent-authored maintenance; does not mark an auto-managed skill as user-edited. */
  managed?: boolean;
  /** Replaces the default history line, for example after a rename. */
  note?: { title: string; detail: string };
  /** Passed through to sync. A rename turns this off so the old name cannot be adopted back. */
  adoptUntracked?: boolean;
}

async function finishEdit(
  name: string,
  before: string,
  options: FinishEditOptions = {}
): Promise<void> {
  const managed = options.managed === true;
  const dir = storeSkillDir(name);
  try {
    await readSkillMd(dir);
  } catch (err) {
    console.error(pc.red(`invalid SKILL.md: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
    return;
  }

  const after = await hashSkillDir(dir);
  if (after === before) {
    console.log(pc.dim(`• ${name} unchanged`));
    return;
  }

  if (managed) await markManagedEdited(name);
  else await markUserEdited(name);
  console.log(pc.green(`✓ updated ${pc.bold(name)}`));
  await syncCommand({ adoptUntracked: options.adoptUntracked });
  await appendHistoryEvent({
    kind: "edited",
    title: options.note?.title ?? `${name} edited`,
    detail:
      options.note?.detail ??
      (managed
        ? "An agent-managed edit was saved and mirrored to every active model."
        : "A manual edit was saved and mirrored to every active model."),
    skillNames: [name],
    agents: sharedSkillAgents(),
    source: managed ? "agent" : "manual",
  });
}

export interface EditOptions {
  stdin?: boolean;
  source?: string;
  /** Agent-authored maintenance; does not mark an auto-managed skill as user-edited. */
  managed?: boolean;
  /** Test/programmatic injection; not exposed as a CLI flag. */
  content?: string;
}

export async function editCommand(name: string, options: EditOptions = {}): Promise<void> {
  const dir = storeSkillDir(name);
  const file = join(dir, "SKILL.md");
  if (!existsSync(file)) {
    console.error(pc.red(`no skill named "${name}"`));
    process.exitCode = 1;
    return;
  }

  const before = await hashSkillDir(dir);
  if (options.stdin && options.source) {
    console.error(pc.red("use either --stdin or --source, not both"));
    process.exitCode = 1;
    return;
  }
  if (options.stdin || options.source || options.content !== undefined) {
    let input: string;
    let sourceDir: string | undefined;
    try {
      if (options.source) {
        const loaded = await loadSkillSource(options.source, {});
        input = loaded.raw.trim();
        sourceDir = loaded.sourceDir;
      } else {
        input = (options.content ?? (await readStdin())).trim();
      }
    } catch (err) {
      console.error(pc.red(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
      return;
    }
    if (!input) {
      console.error(pc.red("no SKILL.md received on stdin"));
      process.exitCode = 1;
      return;
    }

    try {
      const current = await readSkillMd(dir);
      const incoming = parseSkillMd(input);
      if (incoming.frontmatter.name !== name) {
        throw new Error(
          `frontmatter name "${incoming.frontmatter.name}" must match edited skill "${name}"`
        );
      }
      if (sourceDir) await copySkillSource(sourceDir, dir);
      await writeFile(
        file,
        renderSkillMd(
          {
            ...incoming.frontmatter,
            name,
            tier: incoming.frontmatter.tier,
            origin: current.frontmatter.origin ?? "user-created",
            license: incoming.frontmatter.license ?? current.frontmatter.license,
          },
          incoming.body
        ),
        "utf8"
      );
    } catch (err) {
      console.error(pc.red(`invalid SKILL.md: ${err instanceof Error ? err.message : String(err)}`));
      process.exitCode = 1;
      return;
    }
    await finishEdit(name, before, { managed: options.managed });
    return;
  }

  const editor = editorCommand();
  if (!editor) {
    console.error(pc.red("set VISUAL/EDITOR, use --source, or pipe a complete SKILL.md to `sks edit --stdin`"));
    console.log(pc.dim(`  ${file}`));
    process.exitCode = 1;
    return;
  }

  const code = await runEditor(editor, file);
  if (code !== 0) {
    console.error(pc.red(`editor exited with code ${code}`));
    process.exitCode = 1;
    return;
  }

  await finishEdit(name, before, { managed: options.managed });
}

export interface SaveSkillFieldsInput {
  name: string;
  /** New kebab-case name. The store directory and every mirror copy move with it. */
  rename?: string;
  /** Replaces the frontmatter description. Every other frontmatter field is kept. */
  description?: string;
  /** Replaces the body. */
  body?: string;
}

/**
 * Change a skill's name, description, or body and keep the rest of its
 * frontmatter (always, tier, origin, license) as it is.
 *
 * `sks rename` and the desktop app both come through here, so a rename and an
 * edit land in one sync and one history entry. A rename moves the store
 * directory and leaves the old state entry in place: sync prunes the old
 * mirror copies from that entry, then drops it.
 */
export async function saveSkillFields(input: SaveSkillFieldsInput): Promise<boolean> {
  const { name } = input;
  let dir: string;
  try {
    dir = storeSkillDir(name);
  } catch (err) {
    console.error(pc.red(err instanceof Error ? err.message : String(err)));
    process.exitCode = 1;
    return false;
  }
  if (!existsSync(join(dir, "SKILL.md"))) {
    console.error(pc.red(`no skill named "${name}"`));
    process.exitCode = 1;
    return false;
  }

  const rename = input.rename !== undefined && input.rename !== name ? input.rename : undefined;
  if (rename !== undefined) {
    try {
      validateSkillName(rename);
    } catch (err) {
      console.error(pc.red(err instanceof Error ? err.message : String(err)));
      process.exitCode = 1;
      return false;
    }
    if (existsSync(storeSkillDir(rename))) {
      console.error(pc.red(`skill "${rename}" already exists`));
      process.exitCode = 1;
      return false;
    }
    const config = await readConfig();
    for (const link of config.links) {
      const adapter = getAdapter(link.agent);
      if (!adapter.listMirrorSkills) continue;
      if ((await adapter.listMirrorSkills(link.path)).includes(rename)) {
        console.error(
          pc.red(
            `skill "${rename}" already exists in ${adapter.displayName}; run ${pc.bold("sks doctor --repair")} to adopt it before renaming`
          )
        );
        process.exitCode = 1;
        return false;
      }
    }
  }

  const current = await readSkillMd(dir);
  const description =
    input.description === undefined ? current.frontmatter.description : input.description.trim();
  if (!description) {
    console.error(pc.red("description cannot be empty"));
    process.exitCode = 1;
    return false;
  }
  const body = input.body === undefined ? current.body : input.body;
  let rendered: string;
  try {
    rendered = renderSkillMd({ ...current.frontmatter, name: rename ?? name, description }, body);
    parseSkillMd(rendered);
  } catch (err) {
    console.error(pc.red(`invalid SKILL.md: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
    return false;
  }

  const before = await hashSkillDir(dir);
  if (rename !== undefined) {
    const dest = storeSkillDir(rename);
    await renameDir(dir, dest);
    const state = await readState();
    const prior = state.skills[name];
    state.skills[rename] = {
      ...(prior ?? initialSkillState("user-created", { createdBy: "manual" })),
      canonicalHash: "",
      mirrorHashes: {},
    };
    await writeState(state);
    console.log(pc.green(`✓ renamed ${pc.bold(name)} → ${pc.bold(rename)}`));
    dir = dest;
  }
  await writeFile(join(dir, "SKILL.md"), rendered, "utf8");
  await finishEdit(
    rename ?? name,
    before,
    rename !== undefined
      ? {
          adoptUntracked: false,
          note: {
            title: `${name} renamed to ${rename}`,
            detail: `The canonical skill moved to "${rename}" and every active mirror followed.`,
          },
        }
      : {}
  );
  return process.exitCode !== 1;
}

/** `sks rename <skill> <new-name>`: move a skill to a new name everywhere. */
export async function renameCommand(name: string, newName: string): Promise<void> {
  if (name === newName) {
    console.log(pc.dim(`• ${name} already has that name`));
    return;
  }
  await saveSkillFields({ name, rename: newName });
}

export interface ShowOptions {
  json?: boolean;
  path?: boolean;
}

export async function showCommand(name: string, options: ShowOptions = {}): Promise<void> {
  const dir = storeSkillDir(name);
  const file = join(dir, "SKILL.md");
  if (!existsSync(file)) {
    console.error(pc.red(`no skill named "${name}"`));
    process.exitCode = 1;
    return;
  }
  if (options.path) {
    console.log(file);
    return;
  }
  const raw = await readFile(file, "utf8");
  if (!options.json) {
    process.stdout.write(raw);
    return;
  }
  const parsed = parseSkillMd(raw);
  console.log(
    JSON.stringify(
      {
        ...parsed.frontmatter,
        path: file,
        body: parsed.body.trim(),
      },
      null,
      2
    )
  );
}

export interface AddOptions {
  stdin?: boolean;
  /** Mark a skill synthesized by an agent as eligible for future tuning. */
  managed?: boolean;
  /** Test/programmatic injection; not exposed as a CLI flag. */
  content?: string;
  /** Remote sources: pick one skill by name when a repo holds several. */
  skill?: string;
  /** Mark the new skill always-on. */
  always?: boolean;
  /** A tweet with no skill link: build a skill from its text instead of failing. */
  build?: boolean;
}

interface LoadedSkillSource {
  raw: string;
  sourceDir?: string;
  /** Where a remote skill came from. Unset for local sources. */
  origin?: string;
  cleanup?: () => Promise<void>;
}

async function loadSkillSource(
  source: string | undefined,
  options: AddOptions
): Promise<LoadedSkillSource> {
  if (source && isRemoteSource(source)) {
    const resolved = await resolveRemoteSkill(source, { skill: options.skill });
    return {
      raw: await readFile(join(resolved.dir, "SKILL.md"), "utf8"),
      sourceDir: resolved.dir,
      origin: resolved.origin,
      cleanup: resolved.cleanup,
    };
  }
  if (source) {
    const path = resolve(source);
    if (!existsSync(path)) throw new Error(`source does not exist: ${path}`);
    const info = await stat(path);
    if (info.isDirectory()) {
      return { raw: await readFile(join(path, "SKILL.md"), "utf8"), sourceDir: path };
    }
    return { raw: await readFile(path, "utf8") };
  }
  const raw = options.content ?? (await readStdin());
  if (!raw.trim()) {
    throw new Error("pass a skill directory/file or pipe a complete SKILL.md with --stdin");
  }
  return { raw };
}

export async function addCommand(
  source: string | undefined,
  options: AddOptions = {}
): Promise<void> {
  let loaded: LoadedSkillSource;
  try {
    loaded = await loadSkillSource(source, options);
  } catch (err) {
    if (err instanceof RemoteSourceError && err.tweetText && options.build) {
      console.log(pc.dim("the tweet links to no skill; building one from its text"));
      await buildCommand([err.tweetText], {});
      return;
    }
    console.error(pc.red(err instanceof Error ? err.message : String(err)));
    process.exitCode = 1;
    return;
  }
  try {
    await installLoadedSkill(loaded, options);
  } finally {
    await loaded.cleanup?.();
  }
}

async function installLoadedSkill(loaded: LoadedSkillSource, options: AddOptions): Promise<void> {
  let parsed;
  try {
    parsed = parseSkillMd(loaded.raw);
  } catch (err) {
    console.error(pc.red(`invalid SKILL.md: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
    return;
  }
  if (options.always) {
    parsed = { ...parsed, frontmatter: { ...parsed.frontmatter, always: true } };
  }

  const name = parsed.frontmatter.name;
  const dest = storeSkillDir(name);
  if (existsSync(join(dest, "SKILL.md"))) {
    console.error(pc.red(`skill "${name}" already exists; use ${pc.bold(`sks edit ${name} --stdin`)}`));
    process.exitCode = 1;
    return;
  }

  const config = await readConfig();
  for (const link of config.links) {
    const adapter = getAdapter(link.agent);
    if (!adapter.listMirrorSkills) continue;
    const mirrorNames = await adapter.listMirrorSkills(link.path);
    if (mirrorNames.includes(name)) {
      console.error(
        pc.red(
          `skill "${name}" already exists in ${adapter.displayName}; run ${pc.bold("sks doctor --repair")} to adopt it before editing`
        )
      );
      process.exitCode = 1;
      return;
    }
  }

  if (loaded.sourceDir) {
    if (!loaded.origin && basename(loaded.sourceDir) !== name) {
      console.log(pc.yellow(`• source folder "${basename(loaded.sourceDir)}" contains skill "${name}"`));
    }
    await copySkillSource(loaded.sourceDir, dest);
  } else {
    await mkdir(dest, { recursive: true });
  }
  await writeFile(
    join(dest, "SKILL.md"),
    renderSkillMd(
      {
        ...parsed.frontmatter,
        name,
        origin: options.managed ? "auto-created" : "user-created",
      },
      parsed.body
    ),
    "utf8"
  );

  const state = await readState();
  state.skills[name] = options.managed
    ? initialSkillState("auto-created", { createdBy: "agent" })
    : initialSkillState("user-created", { createdBy: "manual" });
  await writeState(state);
  console.log(pc.green(`✓ added ${pc.bold(name)}${parsed.frontmatter.always ? pc.blue(" ∞ always-on") : ""}`));
  if (loaded.origin) console.log(pc.dim(`  from ${loaded.origin}`));
  await syncCommand();
  const nextState = await readState();
  await appendHistoryEvent({
    kind: "created",
    title: `${name} created`,
    detail: loaded.origin
      ? `Added from ${loaded.origin}.`
      : options.managed
        ? "An agent-created skill was added to the canonical library."
        : "A manually authored skill was added to the canonical library.",
    skillNames: [name],
    agents: sharedSkillAgents(),
    source: options.managed ? "agent" : "manual",
  });
}

export interface RemoveOptions {
  /**
   * Also add the name to config.ignore so it is never adopted back from a
   * mirror. Without this, removing a skill that still exists in an agent's own
   * skills directory just invites the next sync to re-adopt it.
   */
  block?: boolean;
}

export async function removeCommand(
  name: string,
  options: RemoveOptions = {}
): Promise<void> {
  const dir = storeSkillDir(name);
  const existsCanonically = existsSync(dir);

  if (!existsCanonically && !options.block) {
    console.error(pc.red(`no skill named "${name}"`));
    process.exitCode = 1;
    return;
  }

  if (options.block) {
    const config = await readConfig();
    const ignore = new Set(config.ignore ?? []);
    if (!ignore.has(name)) {
      ignore.add(name);
      await writeConfig({ ...config, ignore: [...ignore].sort() });
    }
    console.log(pc.dim(`  blocked — ${name} will never be adopted from a mirror`));
  }

  if (!existsCanonically) return;

  const agents = sharedSkillAgents();
  await rm(dir, { recursive: true, force: true });
  console.log(pc.green(`✓ removed ${pc.bold(name)}`));
  // The state entry is deliberately left in place: sync prunes a mirror copy
  // only when it has a recorded hash proving skillset wrote it, and drops the
  // now-orphaned state entry itself once the mirrors are clean.
  await syncCommand({ adoptUntracked: false });
  await appendHistoryEvent({
    kind: "deleted",
    title: `${name} deleted`,
    detail: "The canonical skill and its active model copies were removed.",
    skillNames: [name],
    agents,
    source: "manual",
  });
}

export interface AlwaysOptions {
  /** Return the skill to on-demand loading. */
  off?: boolean;
}

/**
 * `sks always <skill>`: flip a skill between on-demand and always-on.
 *
 * Always-on writes the body into a managed block of every connected agent's
 * global instructions file, so it holds in every session. On-demand leaves it
 * to the agent to pull in when the description matches.
 */
export async function alwaysCommand(name: string, options: AlwaysOptions = {}): Promise<void> {
  const dir = storeSkillDir(name);
  const file = join(dir, "SKILL.md");
  if (!existsSync(file)) {
    console.error(pc.red(`no skill named "${name}"`));
    process.exitCode = 1;
    return;
  }
  const next = !options.off;
  const parsed = await readSkillMd(dir);
  if ((parsed.frontmatter.always === true) === next) {
    console.log(pc.dim(`• ${name} is already ${next ? "always-on" : "on-demand"}`));
    return;
  }
  const before = await hashSkillDir(dir);
  await writeFile(file, renderSkillMd({ ...parsed.frontmatter, always: next }, parsed.body), "utf8");
  console.log(
    next
      ? pc.blue(`∞ ${pc.bold(name)} is now always-on; it goes into every agent's global instructions file`)
      : pc.dim(`○ ${pc.bold(name)} is back to on-demand; agents load it when the description matches`)
  );
  await finishEdit(name, before);
}
