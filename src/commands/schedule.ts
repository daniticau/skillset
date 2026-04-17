import pc from "picocolors";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { installTask, uninstallTask, statusTask } from "../core/scheduler/windows.js";

/**
 * Resolve the absolute path to dist/cli.js regardless of whether we're running
 * under `node dist/cli.js` directly or via `pnpm`/`npx` wrappers. Tries, in
 * order: import.meta.url, then npm-global bin search, then local dist/.
 */
function resolveCliPath(): string {
  // When running via node dist/cli.js, this file's compiled location is the
  // single bundle itself.
  try {
    const here = fileURLToPath(import.meta.url);
    return resolve(here);
  } catch {
    // ESM fileURLToPath should always work; fall through just in case.
  }
  const fallback = join(dirname(process.argv[1] ?? ""), "cli.js");
  if (existsSync(fallback)) return fallback;
  throw new Error("could not resolve path to dist/cli.js — run sks via the built bundle");
}

export interface ScheduleCmdOptions {
  action: "install" | "uninstall" | "status";
  atTime?: string;
}

export async function scheduleCommand(options: ScheduleCmdOptions): Promise<void> {
  if (process.platform !== "win32") {
    console.log(pc.yellow(`sks schedule: Windows-only for now (detected ${process.platform})`));
    console.log(pc.dim(`  on macOS/Linux, run \`sks cycle --nightly\` from cron/launchd`));
    return;
  }

  switch (options.action) {
    case "install": {
      const cliPath = resolveCliPath();
      const nodePath = process.execPath;
      const atTime = options.atTime ?? "02:00";
      try {
        const { taskName, xmlPath } = await installTask({
          atTime,
          nodePath,
          cliPath,
        });
        console.log(pc.green(`✓ scheduled task installed: ${pc.bold(taskName)}`));
        console.log(pc.dim(`  fires daily at ${atTime}`));
        console.log(pc.dim(`  node:  ${nodePath}`));
        console.log(pc.dim(`  cli:   ${cliPath}`));
        console.log(pc.dim(`  xml:   ${xmlPath}`));
        console.log(
          pc.dim(`\n  inspect: ${pc.bold(`schtasks /Query /TN "${taskName}"`)}`)
        );
      } catch (err) {
        console.log(
          pc.red(
            `✗ install failed: ${err instanceof Error ? err.message : String(err)}`
          )
        );
        process.exitCode = 1;
      }
      return;
    }
    case "uninstall": {
      try {
        await uninstallTask();
        console.log(pc.green(`✓ scheduled task removed`));
      } catch (err) {
        console.log(
          pc.red(
            `✗ uninstall failed: ${err instanceof Error ? err.message : String(err)}`
          )
        );
        process.exitCode = 1;
      }
      return;
    }
    case "status": {
      const s = await statusTask();
      if (s.installed) {
        console.log(pc.green(`✓ installed — ${s.taskName}`));
        if (s.raw) {
          const lines = s.raw.split(/\r?\n/).filter((l) =>
            /TaskName|Next Run Time|Status|Last Run Time|Last Result/.test(l)
          );
          for (const l of lines) console.log(pc.dim(`  ${l.trim()}`));
        }
      } else {
        console.log(pc.yellow(`• not installed (${s.reason ?? "unknown"})`));
      }
      return;
    }
  }
}
