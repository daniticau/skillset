import pc from "picocolors";
import { runDeepDive, consoleStageLogger } from "../mine/cycle/deep-dive.js";

export interface DeepDiveCmdOptions {
  max?: number;
  maxSessions?: number;
  restart?: boolean;
  dryRun?: boolean;
}

export async function deepDiveCommand(options: DeepDiveCmdOptions): Promise<void> {
  console.log(pc.bold("deep-dive: foundational skills from recent history"));
  console.log(
    pc.dim("  (heuristic-only extraction; nightly cycles fill in LLM-derived signals)")
  );
  if (options.dryRun) console.log(pc.yellow("  (dry-run — no writes, no state mutations)"));

  const report = await runDeepDive({
    maxSkills: options.max,
    maxSessions: options.maxSessions,
    restart: options.restart,
    dryRun: options.dryRun,
    onStage: consoleStageLogger,
  });

  console.log();
  console.log(
    pc.bold(
      `${report.createdSkills.length} skill(s) created · ${(report.durationMs / 1000).toFixed(1)}s total`
    )
  );
  for (const s of report.createdSkills) {
    console.log(`  ${pc.green("+")} ${pc.bold(s.name)}`);
    if (s.description) console.log(`     ${pc.dim(s.description)}`);
  }
  if (report.createdSkills.length === 0) {
    console.log(pc.dim("  (nothing above threshold — this is fine; nightly cycles will add more)"));
  }
}
