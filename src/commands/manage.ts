import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import pc from "picocolors";
import { initialSkillState, readConfig, readState, writeState } from "../core/config.js";
import {
  hashSkillDir,
  parseSkillMd,
  readSkillMd,
  renderSkillMd,
} from "../core/skill.js";
import { storeSkillDir } from "../core/store.js";
import { getAdapter } from "../core/adapters/index.js";
import { syncCommand } from "./sync.js";

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

async function readStdin(): Promise<string> {
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

const IGNORED_SOURCE_PARTS = new Set([".git", "node_modules", "__pycache__", ".DS_Store"]);

async function copySkillSource(sourceDir: string, dest: string): Promise<void> {
  if (existsSync(dest)) await rm(dest, { recursive: true, force: true });
  await cp(sourceDir, dest, {
    recursive: true,
    filter: (source) => !source.split(/[\\/]/).some((part) => IGNORED_SOURCE_PARTS.has(part)),
  });
}

async function finishEdit(name: string, before: string): Promise<void> {
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

  await markUserEdited(name);
  console.log(pc.green(`✓ updated ${pc.bold(name)}`));
  await syncCommand();
}

export interface EditOptions {
  stdin?: boolean;
  source?: string;
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
            tier: incoming.frontmatter.tier ?? current.frontmatter.tier,
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
    await finishEdit(name, before);
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

  await finishEdit(name, before);
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
  /** Test/programmatic injection; not exposed as a CLI flag. */
  content?: string;
}

async function loadSkillSource(
  source: string | undefined,
  options: AddOptions
): Promise<{ raw: string; sourceDir?: string }> {
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
  let loaded: { raw: string; sourceDir?: string };
  try {
    loaded = await loadSkillSource(source, options);
  } catch (err) {
    console.error(pc.red(err instanceof Error ? err.message : String(err)));
    process.exitCode = 1;
    return;
  }

  let parsed;
  try {
    parsed = parseSkillMd(loaded.raw);
  } catch (err) {
    console.error(pc.red(`invalid SKILL.md: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
    return;
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
    if (basename(loaded.sourceDir) !== name) {
      console.log(pc.yellow(`• source folder "${basename(loaded.sourceDir)}" contains skill "${name}"`));
    }
    await copySkillSource(loaded.sourceDir, dest);
  } else {
    await mkdir(dest, { recursive: true });
  }
  await writeFile(
    join(dest, "SKILL.md"),
    renderSkillMd(
      { ...parsed.frontmatter, name, origin: "user-created" },
      parsed.body
    ),
    "utf8"
  );

  const state = await readState();
  state.skills[name] = initialSkillState("user-created", { createdBy: "manual" });
  await writeState(state);
  console.log(pc.green(`✓ added ${pc.bold(name)}`));
  await syncCommand();
}

export async function removeCommand(name: string): Promise<void> {
  const dir = storeSkillDir(name);
  if (!existsSync(dir)) {
    console.error(pc.red(`no skill named "${name}"`));
    process.exitCode = 1;
    return;
  }

  await rm(dir, { recursive: true, force: true });
  const state = await readState();
  delete state.skills[name];
  await writeState(state);
  console.log(pc.green(`✓ removed ${pc.bold(name)}`));
  await syncCommand({ adoptUntracked: false });
}
