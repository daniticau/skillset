import pc from "picocolors";
import { runNightlyCycle, consoleNightlyLogger } from "../mine/cycle/nightly.js";

export interface CycleCmdOptions {
  nightly?: boolean;
  noIdleCheck?: boolean;
  dryRun?: boolean;
  scheduled?: boolean;
}

export async function cycleCommand(options: CycleCmdOptions): Promise<void> {
  // nightly is the only variant in v1; keeping the flag for future cycle kinds.
  console.log(pc.bold("cycle: nightly"));
  if (options.dryRun) console.log(pc.yellow("  (dry-run)"));

  const outcome = await runNightlyCycle({
    noIdleCheck: options.noIdleCheck,
    dryRun: options.dryRun,
    onStage: consoleNightlyLogger,
  });

  if (!outcome.ran) {
    if (options.scheduled) {
      // Scheduled task: lock-busy and idle-skip are NOT errors. Exit 0 so
      // launchd doesn't treat an intentional skip as a failure.
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
