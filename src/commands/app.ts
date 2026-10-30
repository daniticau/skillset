import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { access, constants, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pc from "picocolors";

const execFileP = promisify(execFile);

const BUNDLE_ID = "com.daniticau.skillset";

export interface AppOptions {
  dir?: string;
  open?: boolean;
}

/** `app/` sits next to `dist/` in the npm package. A git checkout has none. */
export function bundledAppPath(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of [join(here, "..", "app"), join(here, "..", "..", "app")]) {
    const app = join(candidate, "Skillset.app");
    if (existsSync(join(app, "Contents", "MacOS", "Skillset"))) return app;
  }
  return null;
}

/** /Applications when the user can write to it, which admin accounts can. */
export async function defaultInstallDir(): Promise<string> {
  try {
    await access("/Applications", constants.W_OK);
    return "/Applications";
  } catch {
    return join(homedir(), "Applications");
  }
}

/**
 * Copies the app out of the npm package and points it at the Node that runs
 * this command. npm does not quarantine what it unpacks, so Gatekeeper lets the
 * ad-hoc signed copy open without a prompt.
 */
export async function appCommand(options: AppOptions = {}): Promise<void> {
  const source = bundledAppPath();
  if (!source) {
    throw new Error("this copy of Skillset has no built app. In a git checkout, run `pnpm app:install` instead");
  }
  const dir = options.dir ?? (await defaultInstallDir());
  const dest = join(dir, "Skillset.app");

  // A running copy would keep the old binary open while it is replaced.
  await execFileP("osascript", [
    "-e",
    `if application id "${BUNDLE_ID}" is running then tell application id "${BUNDLE_ID}" to quit`,
  ]).catch(() => undefined);
  await mkdir(dir, { recursive: true });
  await rm(dest, { recursive: true, force: true });
  await execFileP("ditto", [source, dest]);
  await writeFile(join(dest, "Contents", "Resources", "node-path.txt"), process.execPath + "\n", "utf8");
  // The new file changes the bundle, so sign it again.
  await execFileP("codesign", ["--force", "--sign", "-", dest]);
  console.log(pc.green(`✓ installed ${dest}`));

  if (options.open !== false) await execFileP("open", [dest]);
}
