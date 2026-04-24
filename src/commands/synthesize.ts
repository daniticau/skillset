import pc from "picocolors";
import { existsSync } from "node:fs";
import { defaultLLMConfig, isAvailable } from "../mine/llm/index.js";
import { synthesizeSkills, writeDraftSkill, DRAFTS_DIR } from "../mine/synthesize.js";
import type { NuggetCluster } from "../mine/types.js";
import { CLUSTERS_FILE, readClusters } from "../mine/artifacts.js";

export interface SynthesizeCmdOptions {
  max?: number;
  minMembers?: number;
}

export async function synthesizeCommand(options: SynthesizeCmdOptions): Promise<void> {
  if (!existsSync(CLUSTERS_FILE)) {
    console.log(pc.yellow(`no clusters yet — run ${pc.bold("skillset mine")} first`));
    return;
  }

  let clusters: NuggetCluster[];
  try {
    clusters = await readClusters();
  } catch (err) {
    console.log(pc.red(`failed to read clusters: ${err instanceof Error ? err.message : String(err)}`));
    return;
  }

  if (clusters.length === 0) {
    console.log(pc.dim("cluster list is empty — nothing to synthesize"));
    return;
  }

  const config = defaultLLMConfig();
  const avail = await isAvailable(config);
  if (!avail.reachable || !avail.modelPresent) {
    console.log(pc.red(`LLM unavailable: ${avail.reason ?? `model "${config.model}" not present`}`));
    if (config.provider === "anthropic") {
      console.log(pc.dim("  set ANTHROPIC_API_KEY in ~/.skillset/.env or your shell"));
    }
    return;
  }

  console.log(pc.dim("synthesizing draft skills…"));

  const skills = await synthesizeSkills(clusters, config, {
    maxSkills: options.max ?? 10,
    minClusterMembers: options.minMembers ?? 2,
    onProgress: (done, total) => {
      process.stderr.write(`\r  synthesizing ${done}/${total}   `);
    },
  });
  process.stderr.write("\n");

  if (skills.length === 0) {
    console.log(pc.dim("no drafts produced"));
    return;
  }

  for (const skill of skills) {
    const path = await writeDraftSkill(skill);
    console.log(pc.green(`✓ draft`) + ` ${pc.bold(skill.name)}  ${pc.dim(path)}`);
    console.log(pc.dim(`    ${skill.description}`));
  }
  console.log();
  console.log(pc.dim(`${skills.length} drafts → ${DRAFTS_DIR}`));
  console.log(
    pc.dim(`run ${pc.bold("skillset drafts")} to review, ${pc.bold("skillset promote <name>")} to publish`)
  );
}
