import pc from "picocolors";
import { readState, DEFAULT_CYCLE_CONFIG } from "../core/config.js";
import { defaultLLMConfig, isAvailable } from "../mine/llm/index.js";
import { runCleanup } from "../mine/cleanup/index.js";
import { sync } from "../core/mirror.js";

export interface CleanupCmdOptions {
  dryRun?: boolean;
}

export async function cleanupCommand(options: CleanupCmdOptions): Promise<void> {
  console.log(pc.bold("cleanup: conflict + dedup + prune"));
  if (options.dryRun) console.log(pc.yellow("  (dry-run)"));

  const llmConfig = defaultLLMConfig();
  const avail = await isAvailable(llmConfig);
  if (!avail.reachable) {
    console.log(pc.red(`LLM unavailable: ${avail.reason ?? "no response"}`));
    process.exitCode = 1;
    return;
  }

  const state = await readState();
  const cfg = { ...DEFAULT_CYCLE_CONFIG, ...state.config };

  const report = await runCleanup({
    llmConfig,
    mergeCap: cfg.cycleDefaults.mergeCap,
    dryRun: options.dryRun,
    pruneEnabled: !options.dryRun && cfg.cleanup.pruneEnabled,
    pruneCap: cfg.cycleDefaults.pruneCap,
    onEvent: (event, detail) => {
      const icon = event.endsWith("-error")
        ? pc.red("✗")
        : event.startsWith("conflict-resolved") || event.startsWith("merged")
          ? pc.green("✓")
          : pc.dim("›");
      console.log(`  ${icon} ${event}${detail ? pc.dim(` ${detail}`) : ""}`);
    },
  });

  console.log();
  console.log(
    pc.bold(
      `${report.conflictsResolved.length} conflict(s) · ${report.merges.length} merge(s) · ${report.prunedCandidates.length} prune candidate(s)`
    )
  );

  if ((report.conflictsResolved.length > 0 || report.merges.length > 0) && !options.dryRun) {
    console.log(pc.dim("syncing mirrors…"));
    await sync();
  }
}
