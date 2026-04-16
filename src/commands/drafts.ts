import pc from "picocolors";
import { rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { listDrafts, promoteDraft, DRAFTS_DIR } from "../mine/synthesize.js";
import { syncCommand } from "./sync.js";

export async function draftsCommand(): Promise<void> {
  const drafts = await listDrafts();
  if (drafts.length === 0) {
    console.log(
      pc.dim(
        `no drafts found at ${DRAFTS_DIR}\nrun ${pc.bold("skillset mine --llm --synthesize")} to generate some`
      )
    );
    return;
  }

  console.log(pc.bold(`${drafts.length} draft skill(s):`));
  console.log();
  for (const d of drafts) {
    console.log(`  ${pc.green("●")} ${pc.bold(d.name)}`);
    console.log(`    ${pc.dim(d.description)}`);
    console.log(`    ${pc.dim(d.path)}`);
    console.log();
  }
  console.log(pc.dim(`review a draft: open its SKILL.md`));
  console.log(pc.dim(`promote: ${pc.bold("skillset promote <name>")}`));
  console.log(pc.dim(`discard: ${pc.bold("skillset drafts --rm <name>")}`));
}

export async function promoteCommand(name: string, options: { noSync?: boolean }): Promise<void> {
  try {
    const dst = await promoteDraft(name);
    console.log(pc.green(`✓ promoted ${pc.bold(name)} → ${dst}`));

    if (!options.noSync) {
      console.log(pc.dim("syncing mirrors…"));
      await syncCommand();
    } else {
      console.log(pc.dim(`(skipped sync — run ${pc.bold("skillset sync")} manually)`));
    }
  } catch (err) {
    console.error(pc.red(`error: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  }
}

export async function discardDraftCommand(name: string): Promise<void> {
  const dir = join(DRAFTS_DIR, name);
  if (!existsSync(dir)) {
    console.error(pc.red(`no draft named "${name}" at ${dir}`));
    process.exitCode = 1;
    return;
  }
  await rm(dir, { recursive: true, force: true });
  console.log(pc.green(`✓ discarded draft ${pc.bold(name)}`));
}
