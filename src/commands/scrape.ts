import pc from "picocolors";
import { mkdir } from "node:fs/promises";
import { SESSIONS_DIR } from "../core/paths.js";
import { readState, writeState } from "../core/config.js";
import { scrapeAll } from "../ingest/sessions/index.js";
import type {
  ScrapeOptions,
  ScrapeSource,
  ScrapeSummary,
} from "../ingest/sessions/types.js";

export interface ScrapeRunOptions extends ScrapeOptions {
  quiet?: boolean;
  heading?: string;
}

export interface ScrapeRunResult {
  summary: ScrapeSummary;
  totalWritten: number;
}

function plural(n: number, singular: string, pluralWord = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralWord}`;
}

function printScrapeSummary(summary: ScrapeSummary): number {
  let totalWritten = 0;
  for (const r of summary.perSource) {
    totalWritten += r.sessionsWritten;
    if (!r.available) {
      console.log(`  ${pc.dim(r.source.padEnd(12))} ${pc.dim(r.reason ?? "unavailable")}`);
      continue;
    }
    const bits = [`${r.sessionsWritten} written`];
    if (r.sessionsSkipped) bits.push(`${r.sessionsSkipped} skipped`);
    if (r.locked) bits.push(pc.yellow(`${r.locked} locked`));
    console.log(`  ${pc.dim(r.source.padEnd(12))} ${bits.join(", ")}`);
  }
  console.log(
    pc.green(
      `✓ scraped ${plural(totalWritten, "session")} in ${(summary.totalMs / 1000).toFixed(1)}s`
    )
  );
  return totalWritten;
}

export async function runScrape(
  options: ScrapeRunOptions = {}
): Promise<ScrapeRunResult> {
  const state = await readState();
  await mkdir(SESSIONS_DIR, { recursive: true });
  if (!options.quiet) {
    console.log(pc.dim(options.heading ?? "scraping transcripts from linked agents..."));
  }

  const scrapeOptions: ScrapeOptions = {
    ...(options.source ? { source: options.source } : {}),
    ...(options.full ? { full: options.full } : {}),
  };
  const { summary, nextCursors } = await scrapeAll(
    SESSIONS_DIR,
    state.scrape ?? {},
    scrapeOptions
  );
  await writeState({ ...state, scrape: { ...(state.scrape ?? {}), ...nextCursors } });

  const totalWritten = options.quiet
    ? summary.perSource.reduce((sum, r) => sum + r.sessionsWritten, 0)
    : printScrapeSummary(summary);
  return { summary, totalWritten };
}

export interface ScrapeCommandOptions {
  source?: ScrapeSource;
  full?: boolean;
}

export async function scrapeCommand(options: ScrapeCommandOptions = {}): Promise<void> {
  await runScrape(options);
}
