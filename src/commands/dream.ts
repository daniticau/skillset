import pc from "picocolors";
import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  dreamScheduleStatus,
  installDreamLaunchAgent,
  uninstallDreamLaunchAgent,
} from "../core/scheduler/macos.js";
import { readState } from "../core/config.js";
import { runNightlyCycle, consoleNightlyLogger } from "../mine/cycle/nightly.js";

export interface DreamCmdOptions {
  at?: string;
  status?: boolean;
  off?: boolean;
  runNow?: boolean;
  scheduled?: boolean;
  force?: boolean;
}

function resolveCliPath(): string {
  try {
    const here = fileURLToPath(import.meta.url);
    return resolve(here);
  } catch {
    // fall through
  }
  const fallback = join(dirname(process.argv[1] ?? ""), "cli.js");
  if (existsSync(fallback)) return realpathSync(fallback);
  throw new Error("could not resolve path to dist/cli.js");
}

function recentReviewedRows(
  reviewedDates: Awaited<ReturnType<typeof readState>>["reviewedDates"]
): string[] {
  const rows = Object.entries(reviewedDates ?? {})
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 7)
    .map(([day, record]) => {
      const bits = [
        record.status,
        `${record.sessionsReviewed} sessions`,
        `${record.mistakeClusters} mistakes`,
        `${record.preferenceClusters} prefs`,
        `${record.skillsCreated} created`,
        `${record.skillsEdited} edited`,
      ];
      return `  ${day}  ${pc.dim(bits.join(" · "))}`;
    });
  return rows.length > 0 ? rows : [pc.dim("  no reviewed days recorded yet")];
}

async function printDreamStatus(): Promise<void> {
  const status = await dreamScheduleStatus();
  console.log(pc.bold("Dream"));
  if (status.installed) {
    console.log(`  ${pc.green("✓")} launch agent ${pc.bold(status.label)}`);
    if (status.atTime) console.log(`  ${pc.dim("time")} ${status.atTime}`);
    console.log(`  ${pc.dim("plist")} ${status.plistPath}`);
    if (status.reason) console.log(`  ${pc.yellow("•")} loaded status unknown: ${status.reason}`);
  } else {
    console.log(`  ${pc.yellow("•")} not installed (${status.reason ?? "unknown"})`);
  }

  const state = await readState();
  const today = new Date();
  const key = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ].join("-");
  const todayRecord = state.reviewedDates?.[key];
  console.log();
  console.log(pc.bold("Reviewed Days"));
  if (todayRecord) {
    console.log(`  today ${pc.dim(todayRecord.status)}`);
    if (todayRecord.skipReason) console.log(`  ${pc.dim(todayRecord.skipReason)}`);
  } else {
    console.log(pc.dim("  today not reviewed yet"));
  }
  for (const row of recentReviewedRows(state.reviewedDates)) console.log(row);
}

async function runDreamNow(options: DreamCmdOptions): Promise<void> {
  console.log(pc.bold("dream: nightly improvement"));
  const outcome = await runNightlyCycle({
    force: options.force,
    noIdleCheck: !options.scheduled,
    onStage: consoleNightlyLogger,
  });

  if (!outcome.ran) {
    if (options.scheduled) {
      console.log(pc.dim(`  (skipped: ${outcome.reason})`));
      return;
    }
    console.log(pc.yellow(`skipped: ${outcome.reason}`));
    return;
  }

  const r = outcome.report;
  console.log();
  console.log(
    pc.bold(
      `${r.createdSkills.length} created · ${r.editedSkills.length} edited · ${(r.durationMs / 1000).toFixed(1)}s`
    )
  );
}

export async function dreamCommand(options: DreamCmdOptions = {}): Promise<void> {
  if (options.status) {
    await printDreamStatus();
    return;
  }
  if (options.off) {
    const status = await dreamScheduleStatus();
    await uninstallDreamLaunchAgent();
    console.log(pc.green(`✓ dream disabled`));
    console.log(pc.dim(`  removed ${status.plistPath}`));
    return;
  }
  if (options.runNow) {
    await runDreamNow(options);
    return;
  }

  const atTime = options.at ?? "02:00";
  const result = await installDreamLaunchAgent({
    atTime,
    nodePath: process.execPath,
    cliPath: resolveCliPath(),
  });
  console.log(pc.green(`✓ dream enabled`));
  console.log(pc.dim(`  fires nightly at ${result.atTime}`));
  console.log(pc.dim(`  launch agent: ${result.label}`));
  console.log(pc.dim(`  plist: ${result.plistPath}`));
}
