import pc from "picocolors";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  STORE_ROOT,
  STORE_SKILLS_DIR,
  SESSIONS_DIR,
  CONFIG_FILE,
  STATE_FILE,
} from "../core/paths.js";
import { defaultLLMConfig, isAvailable } from "../mine/llm/index.js";
import { DRAFTS_DIR } from "../mine/synthesize.js";
import { readConfig, readState } from "../core/config.js";
import { listSkillDirs } from "../core/skill.js";
import { getSessionStats } from "../mine/index.js";

const OK = pc.green("✓");
const MISS = pc.yellow("•");
const ERR = pc.red("✗");

function label(text: string): string {
  return text.padEnd(14);
}

function present(path: string): string {
  return existsSync(path) ? OK : MISS;
}

async function countFile(path: string): Promise<number> {
  if (!existsSync(path)) return 0;
  try {
    const raw = await readFile(path, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data.length : 0;
  } catch {
    return 0;
  }
}

async function countDirs(root: string): Promise<number> {
  if (!existsSync(root)) return 0;
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).length;
  } catch {
    return 0;
  }
}

async function sectionPaths(): Promise<void> {
  console.log(pc.bold("Paths"));
  console.log(`  ${label("store")} ${present(STORE_ROOT)} ${pc.dim(STORE_ROOT)}`);
  console.log(`  ${label("config")} ${present(CONFIG_FILE)} ${pc.dim(CONFIG_FILE)}`);
  console.log(`  ${label("state")} ${present(STATE_FILE)} ${pc.dim(STATE_FILE)}`);
  console.log();
}

async function sectionLLM(verbose: boolean): Promise<void> {
  const config = defaultLLMConfig();
  const providerLabel =
    config.provider === "anthropic" ? "Anthropic API" : "local Ollama";
  console.log(pc.bold(`LLM (${providerLabel})`));
  console.log(`  ${label("provider")} ${pc.dim(config.provider)}`);
  const modelFromEnv = process.env.SKILLSET_LLM_MODEL === config.model;
  console.log(
    `  ${label("model")} ${pc.dim(config.model)}${
      modelFromEnv ? pc.dim(" (from env)") : pc.dim(" (default)")
    }`
  );
  if (config.provider === "ollama") {
    console.log(
      `  ${label("endpoint")} ${pc.dim(config.baseUrl)}${
        process.env.SKILLSET_LLM_URL ? pc.dim(" (from env)") : pc.dim(" (default)")
      }`
    );
  }
  console.log(
    `  ${label("embedding")} ${pc.dim(config.embeddingModel ?? "(unset — TF-IDF fallback)")}`
  );

  process.stderr.write(`  ${label("reachable")} ${pc.dim("checking…")}\r`);
  const avail = await isAvailable(config);
  process.stderr.write("\x1b[2K\r");

  if (!avail.reachable) {
    console.log(`  ${label("reachable")} ${ERR} ${pc.red(avail.reason ?? "unknown")}`);
    if (config.provider === "anthropic") {
      console.log(pc.dim(`    Set ANTHROPIC_API_KEY in ~/.skillset/.env or your shell.`));
    } else {
      console.log(pc.dim(`    Is Ollama running on the host? Try:`));
      console.log(pc.dim(`      curl ${config.baseUrl.replace(/\/v1\/?$/, "")}/api/tags`));
    }
  } else {
    console.log(`  ${label("reachable")} ${OK}`);
    if (avail.modelPresent) {
      console.log(`  ${label("model found")} ${OK}`);
    } else {
      console.log(
        `  ${label("model found")} ${ERR} ${pc.red(`"${config.model}" not available`)}`
      );
      if (config.provider === "ollama") {
        console.log(pc.dim(`    pull it: ${pc.bold(`ollama pull ${config.model}`)}`));
      }
    }
    if ((verbose || !avail.modelPresent) && config.provider === "ollama") {
      const list = avail.models.length > 0 ? avail.models.join(", ") : "(none)";
      console.log(`  ${label("available")} ${pc.dim(list)}`);
    }
  }
  console.log();
}

async function sectionStore(): Promise<void> {
  console.log(pc.bold("Store"));
  const skillDirs = existsSync(STORE_SKILLS_DIR) ? await listSkillDirs(STORE_SKILLS_DIR) : [];
  const draftCount = await countDirs(DRAFTS_DIR);

  const nuggetsFile = join(STORE_ROOT, "nuggets", "nuggets.json");
  const clustersFile = join(STORE_ROOT, "nuggets", "clusters.json");
  const nuggetCount = await countFile(nuggetsFile);
  const clusterCount = await countFile(clustersFile);

  console.log(`  ${label("skills")} ${pc.dim(String(skillDirs.length))}`);
  console.log(`  ${label("drafts")} ${pc.dim(String(draftCount))}`);
  console.log(`  ${label("nuggets")} ${pc.dim(String(nuggetCount))}`);
  console.log(`  ${label("clusters")} ${pc.dim(String(clusterCount))}`);
  console.log();
}

async function sectionMirrors(): Promise<void> {
  console.log(pc.bold("Mirrors"));
  const config = await readConfig();
  if (config.links.length === 0) {
    console.log(pc.dim(`  (none linked — run ${pc.bold("skillset init")} or ${pc.bold("skillset link <agent>")})`));
  } else {
    for (const link of config.links) {
      const exists = existsSync(link.path);
      const count = exists ? (await listSkillDirs(link.path)).length : 0;
      console.log(
        `  ${exists ? OK : ERR} ${pc.bold(link.agent.padEnd(12))} ${pc.dim(link.path)} ${pc.dim(`(${count} skills)`)}`
      );
    }
  }
  console.log();
}

async function sectionSessions(): Promise<void> {
  console.log(pc.bold("Sessions"));
  const stats = getSessionStats();
  if (stats.userSessions === 0) {
    console.log(
      pc.dim(`  no scraped sessions in ${SESSIONS_DIR} — run ${pc.bold("skillset mine")} to scrape + mine`)
    );
    console.log();
    return;
  }

  for (const src of ["claude-code", "codex", "cursor"] as const) {
    const entry = stats.bySource[src];
    if (entry.sessions === 0) continue;
    const mb = (entry.bytes / 1024 / 1024).toFixed(1);
    console.log(`  ${label(src)} ${pc.dim(`${entry.sessions} sessions (${mb} MB)`)}`);
  }
  console.log(
    `  ${label("total")} ${pc.dim(
      `${stats.userSessions} sessions across ${stats.projects} project slug(s) (${(stats.totalSizeBytes / 1024 / 1024).toFixed(1)} MB)`
    )}`
  );
  console.log();
}

async function sectionMine(): Promise<void> {
  console.log(pc.bold("Mine state"));
  const state = await readState();
  const mine = state.mine;
  if (!mine) {
    console.log(pc.dim(`  (nothing mined yet — run ${pc.bold("skillset mine")})`));
  } else {
    const processed = Object.keys(mine.processedSessions).length;
    console.log(`  ${label("pipeline")} ${pc.dim(`v${mine.pipelineVersion}`)}`);
    console.log(`  ${label("processed")} ${pc.dim(`${processed} sessions`)}`);
    if (mine.lastRunAt) {
      console.log(`  ${label("last run")} ${pc.dim(mine.lastRunAt)}`);
    }
  }
  console.log();
}

export interface DoctorOptions {
  verbose?: boolean;
}

export async function doctorCommand(options: DoctorOptions = {}): Promise<void> {
  await sectionPaths();
  await sectionLLM(options.verbose ?? false);
  await sectionStore();
  await sectionMirrors();
  await sectionSessions();
  await sectionMine();
}
