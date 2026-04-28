import pc from "picocolors";
import { listStoreSkills } from "../core/store.js";
import {
  appendUsageEvents,
  createExplicitUsageEvent,
  readUsageEvents,
  summarizeUsage,
} from "../usage/events.js";
import { scanUsageFromSessions } from "../usage/scan.js";
import { runScrape } from "./scrape.js";

export interface UsageScanCmdOptions {
  scrape?: boolean;
  fullScrape?: boolean;
  force?: boolean;
  project?: string;
  /** Back-compat for tests/callers that phrase this as an opt-out. */
  noScrape?: boolean;
}

export interface UsageRecordCmdOptions {
  agent?: string;
  at?: string;
  project?: string;
  evidence?: string;
}

function plural(n: number, singular: string, pluralWord = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralWord}`;
}

function dateOnly(iso: string | undefined): string {
  return iso ? iso.slice(0, 10) : "never";
}

function truncate(s: string, max: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : clean.slice(0, max - 1) + "...";
}

export async function usageCommand(skillName?: string): Promise<void> {
  const events = await readUsageEvents();
  if (skillName) {
    const filtered = events
      .filter((e) => e.skillName === skillName)
      .sort((a, b) => b.usedAt.localeCompare(a.usedAt));
    console.log(pc.bold(`Usage for ${skillName}`));
    if (filtered.length === 0) {
      console.log(pc.dim("  no observed usage yet"));
      return;
    }
    for (const event of filtered) {
      const bits = [
        event.usedAt,
        event.agent,
        event.source,
        `confidence ${event.confidence.toFixed(2)}`,
      ];
      if (event.project) bits.push(event.project);
      console.log(`  ${pc.dim(bits.join(" · "))}`);
      if (event.evidence) console.log(`    ${pc.dim(truncate(event.evidence, 140))}`);
    }
    return;
  }

  const summaries = [...summarizeUsage(events).values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? "");
  });
  if (summaries.length === 0) {
    console.log(pc.dim("no observed skill usage yet — run `sks usage scan` after scraping sessions"));
    return;
  }

  console.log(pc.bold("Observed skill usage"));
  for (const summary of summaries) {
    console.log(
      `  ${pc.bold(summary.skillName)}  ${plural(summary.count, "use")} ` +
        pc.dim(
          `(${summary.explicitCount} explicit, ${summary.inferredCount} inferred) last ${dateOnly(summary.lastUsedAt)}${summary.lastAgent ? ` via ${summary.lastAgent}` : ""}`
        )
    );
  }
}

export async function usageRecordCommand(
  skillName: string,
  options: UsageRecordCmdOptions = {}
): Promise<void> {
  const known = new Set(await listStoreSkills());
  if (!known.has(skillName)) {
    console.error(pc.red(`unknown skill "${skillName}" — run \`sks list\` to see canonical skills`));
    process.exitCode = 1;
    return;
  }
  const usedAt = options.at ? new Date(options.at).toISOString() : new Date().toISOString();
  const event = createExplicitUsageEvent({
    skillName,
    agent: options.agent,
    usedAt,
    project: options.project,
    evidence: options.evidence,
  });
  const result = await appendUsageEvents([event]);
  if (result.added > 0) {
    console.log(pc.green(`✓ recorded observed use of ${pc.bold(skillName)} at ${dateOnly(usedAt)}`));
  } else {
    console.log(pc.dim(`already recorded observed use of ${skillName} at ${usedAt}`));
  }
}

export async function usageScanCommand(
  options: UsageScanCmdOptions = {}
): Promise<void> {
  const shouldScrape = options.scrape === true && options.noScrape !== true;
  if (shouldScrape) {
    await runScrape({
      full: options.fullScrape,
      heading: "scraping transcripts before usage scan...",
    });
  }

  const report = await scanUsageFromSessions({
    project: options.project,
    force: options.force,
  });
  console.log(
    pc.green(`✓ ${plural(report.added, "observed use")} added`) +
      pc.dim(
        ` (${report.inferred} inferred candidate(s), ${report.scanned} scanned, ${report.skipped} skipped, ${report.knownSkills} known skill(s))`
      )
  );
}
