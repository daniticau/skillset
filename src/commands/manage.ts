import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import pc from "picocolors";
import { readState, writeState } from "../core/config.js";
import { hashSkillDir, readSkillMd } from "../core/skill.js";
import { storeSkillDir } from "../core/store.js";
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

export async function editCommand(name: string): Promise<void> {
  const dir = storeSkillDir(name);
  const file = join(dir, "SKILL.md");
  if (!existsSync(file)) {
    console.error(pc.red(`no skill named "${name}"`));
    process.exitCode = 1;
    return;
  }

  const editor = editorCommand();
  if (!editor) {
    console.error(pc.red("set VISUAL or EDITOR to use `sks edit`"));
    console.log(pc.dim(`  ${file}`));
    process.exitCode = 1;
    return;
  }

  const before = await hashSkillDir(dir);
  const code = await runEditor(editor, file);
  if (code !== 0) {
    console.error(pc.red(`editor exited with code ${code}`));
    process.exitCode = 1;
    return;
  }

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

  console.log(pc.green(`✓ updated ${pc.bold(name)}`));
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
