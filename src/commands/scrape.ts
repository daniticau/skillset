import pc from "picocolors";
import { mkdir } from "node:fs/promises";
import { scrapeAll } from "../ingest/sessions/index.js";
import type { ScrapeOptions, ScrapeSource } from "../ingest/sessions/types.js";
import { readState, writeState } from "../core/config.js";
import { SESSIONS_DIR } from "../core/paths.js";

const VALID_SOURCES: ScrapeSource[] = ["claude-code", "codex", "cursor"];

export async function scrapeCommand(options: ScrapeOptions): Promise<void> {
  if (options.source && !VALID_SOURCES.includes(options.source)) {
    console.error(
      pc.red(`unknown source "${options.source}" — valid: ${VALID_SOURCES.join(", ")}`)
    );
    process.exitCode = 1;
    return;
  }

  await mkdir(SESSIONS_DIR, { recursive: true });

  const state = await readState();
  const cursors = state.scrape ?? {};

  const { summary, nextCursors } = await scrapeAll(SESSIONS_DIR, cursors, options);

  await writeState({ ...state, scrape: nextCursors });

  let totalWritten = 0;
  for (const r of summary.perSource) {
    totalWritten += r.sessionsWritten;
    const label = pc.bold(r.source.padEnd(12));
    if (!r.available) {
      console.log(
        `${label} ${pc.dim(r.reason ?? "unavailable")}`
      );
      continue;
    }
    const bits: string[] = [`${r.sessionsWritten} written`];
    if (r.sessionsSkipped) bits.push(`${r.sessionsSkipped} skipped`);
    if (r.locked) bits.push(pc.yellow(`${r.locked} locked`));
    console.log(`${label} ${bits.join(", ")}`);
  }
  console.log(
    pc.green(`✓ scraped ${totalWritten} session(s) in ${(summary.totalMs / 1000).toFixed(1)}s`) +
      pc.dim(`  → ${SESSIONS_DIR}`)
  );
}
