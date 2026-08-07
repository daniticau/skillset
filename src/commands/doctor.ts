import pc from "picocolors";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  STORE_ROOT,
  STORE_SKILLS_DIR,
  CONFLICTS_DIR,
  CONFIG_FILE,
  STATE_FILE,
} from "../core/paths.js";
import { defaultLLMConfig, isAvailable } from "../llm/index.js";
import type { Provider } from "../llm/index.js";
import { readConfig, readState } from "../core/config.js";
import type { Link } from "../core/config.js";
import { getAdapter } from "../core/adapters/index.js";
import { listSkillDirs } from "../core/skill.js";
import { sync } from "../core/mirror.js";
import { printSyncReport } from "./sync.js";

const OK = pc.green("✓");
const MISS = pc.yellow("•");
const ERR = pc.red("✗");

function label(text: string): string {
  return text.padEnd(14);
}

function present(path: string): string {
  return existsSync(path) ? OK : MISS;
}

async function describeMirror(link: Link): Promise<{ name: string; detail: string }> {
  try {
    const adapter = getAdapter(link.agent);
    const name = adapter.displayName.padEnd(12);
    if (adapter.listMirrorSkills) {
      const count = (await adapter.listMirrorSkills(link.path)).length;
      return {
        name,
        detail: `${count} skill${count === 1 ? "" : "s"}`,
      };
    }
    if (adapter.layout === "aggregate-file") {
      const managed = adapter.hashAggregate
        ? await adapter.hashAggregate(link.path)
        : null;
      return {
        name,
        detail: managed ? "managed aggregate file" : "aggregate file",
      };
    }
    return { name, detail: adapter.layout };
  } catch {
    return { name: link.agent.padEnd(12), detail: "unknown mirror" };
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
  const providerLabel = llmProviderLabel(config.provider);
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
    } else if (config.provider === "ollama") {
      console.log(pc.dim(`    Is Ollama running on the host? Try:`));
      console.log(pc.dim(`      curl ${config.baseUrl.replace(/\/v1\/?$/, "")}/api/tags`));
    } else {
      const cliName = llmProviderLabel(config.provider);
      console.log(pc.dim(`    Is ${cliName} installed and logged in?`));
      console.log(
        pc.dim(`    Or pick another: ${pc.bold("SKILLSET_LLM_PROVIDER=grok-cli")}`)
      );
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

export function llmProviderLabel(provider: Provider): string {
  switch (provider) {
    case "claude-cli":
      return "Claude CLI";
    case "codex-cli":
      return "Codex CLI";
    case "kimi-cli":
      return "Kimi CLI";
    case "grok-cli":
      return "Grok CLI";
    case "anthropic":
      return "Anthropic API";
    case "ollama":
      return "local Ollama";
  }
}

async function sectionStore(): Promise<void> {
  console.log(pc.bold("Store"));
  const skillDirs = existsSync(STORE_SKILLS_DIR) ? await listSkillDirs(STORE_SKILLS_DIR) : [];

  console.log(`  ${label("skills")} ${pc.dim(String(skillDirs.length))}`);
  console.log();
}

async function sectionMirrors(): Promise<void> {
  console.log(pc.bold("Mirrors"));
  const config = await readConfig();
  const canonical = new Set(
    existsSync(STORE_SKILLS_DIR) ? (await listSkillDirs(STORE_SKILLS_DIR)).map((dir) => dir.split("/").pop()!) : []
  );
  if (config.links.length === 0) {
    console.log(pc.dim(`  (none connected — run ${pc.bold("sks init")} or ${pc.bold("sks connect <agent>")})`));
  } else {
    for (const link of config.links) {
      const exists = existsSync(link.path);
      const mirror = await describeMirror(link);
      let drift = "";
      try {
        const adapter = getAdapter(link.agent);
        if (adapter.listMirrorSkills) {
          const ignored = new Set(config.ignore ?? []);
          const vendor = new Set(
            adapter.vendorSkills ? await adapter.vendorSkills(link.path) : []
          );
          const mirrorNames = new Set(await adapter.listMirrorSkills(link.path));
          const pending = [...mirrorNames].filter(
            (name) => !canonical.has(name) && !ignored.has(name) && !vendor.has(name)
          ).length;
          const ignoredHere = [...mirrorNames].filter((name) => ignored.has(name)).length;
          const vendorHere = [...mirrorNames].filter((name) => vendor.has(name)).length;
          const missing = [...canonical].filter((name) => !mirrorNames.has(name)).length;
          const bits = [
            pending > 0 ? `${pending} pending import${pending === 1 ? "" : "s"}` : "",
            missing > 0 ? `${missing} missing` : "",
            ignoredHere > 0 ? `${ignoredHere} ignored` : "",
            vendorHere > 0 ? `${vendorHere} built-in` : "",
          ].filter(Boolean);
          if (bits.length > 0) drift = ` ${pc.yellow(`[${bits.join(", ")}]`)}`;
        }
      } catch {
        // The basic mirror health line still provides useful diagnostics.
      }
      console.log(
        `  ${exists ? OK : ERR} ${pc.bold(mirror.name)} ${pc.dim(link.path)} ${pc.dim(`(${mirror.detail})`)}${drift}`
      );
    }
  }
  console.log();
}

async function sectionConflicts(): Promise<void> {
  console.log(pc.bold("Conflicts"));
  const state = await readState();
  let total = 0;
  let lastAt: string | undefined;
  for (const skill of Object.values(state.skills)) {
    const history = skill.conflictHistory ?? [];
    total += history.length;
    if (history.length > 0) {
      const latest = history[history.length - 1]!.at;
      if (!lastAt || latest > lastAt) lastAt = latest;
    }
  }
  if (total === 0) {
    console.log(pc.dim(`  none recorded — multi-mirror divergences will land in ${CONFLICTS_DIR}`));
  } else {
    console.log(`  ${label("archived")} ${pc.dim(`${total} conflict(s) across ${Object.values(state.skills).filter((s) => (s.conflictHistory?.length ?? 0) > 0).length} skill(s)`)}`);
    if (lastAt) console.log(`  ${label("last at")} ${pc.dim(lastAt)}`);
    console.log(`  ${label("archive")} ${pc.dim(CONFLICTS_DIR)}`);
  }
  console.log();
}

export interface DoctorOptions {
  verbose?: boolean;
  repair?: boolean;
}

export async function doctorCommand(options: DoctorOptions = {}): Promise<void> {
  if (options.repair) {
    console.log(pc.bold("Repair"));
    printSyncReport(await sync({ importExisting: true }));
    console.log();
  }
  await sectionPaths();
  await sectionLLM(options.verbose ?? false);
  await sectionStore();
  await sectionMirrors();
  await sectionConflicts();
}
