import pc from "picocolors";
import { existsSync } from "node:fs";
import { lstat, readdir, readFile, readlink, stat, symlink, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
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
import { alwaysBlockState } from "../core/adapters/always-block.js";
import { listSkillDirs, readSkillMd } from "../core/skill.js";
import type { ParsedSkill } from "../core/skill.js";
import { listStoreSkills, storeSkillDir } from "../core/store.js";
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

/**
 * The canonical skills dir is often a symlink into a repo the user keeps
 * elsewhere. When that repo moves, the link dangles: every command sees an
 * empty store, and a sync would prune every mirror. Surface it loudly.
 */
async function skillsDirLink(): Promise<{ target?: string; dangling: boolean }> {
  try {
    const info = await lstat(STORE_SKILLS_DIR);
    if (!info.isSymbolicLink()) return { dangling: false };
    const target = await readlink(STORE_SKILLS_DIR);
    return { target, dangling: !existsSync(STORE_SKILLS_DIR) };
  } catch {
    return { dangling: false };
  }
}

const SEARCH_SKIP = new Set(["node_modules", "Library", ".Trash"]);

/** Breadth-first search under home for a folder with this name that holds skills. */
async function findSkillsDirCandidates(name: string, root = homedir(), maxDepth = 4): Promise<string[]> {
  const found: string[] = [];
  let frontier = [{ dir: root, depth: 0 }];
  while (frontier.length > 0) {
    const next: typeof frontier = [];
    for (const { dir, depth } of frontier) {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".") || SEARCH_SKIP.has(entry.name)) continue;
        const abs = join(dir, entry.name);
        if (entry.name === name && (await listSkillDirs(abs)).length > 0) {
          found.push(abs);
          continue;
        }
        if (depth + 1 < maxDepth) next.push({ dir: abs, depth: depth + 1 });
      }
    }
    frontier = next;
  }
  return found.sort();
}

async function repairSkillsLink(explicit?: string): Promise<void> {
  const link = await skillsDirLink();
  if (explicit && !link.target) {
    console.log(`  ${ERR} ${pc.dim(STORE_SKILLS_DIR)} is a real folder, not a link; nothing to repoint`);
    return;
  }
  if (!link.target || (!link.dangling && !explicit)) return;

  let next = explicit ? resolve(explicit) : undefined;
  if (!next) {
    const wanted = basename(link.target);
    process.stderr.write(`  ${pc.dim(`store link → ${link.target} is missing; searching ${homedir()} for ${wanted}…`)}\r`);
    const candidates = await findSkillsDirCandidates(wanted);
    process.stderr.write("\x1b[2K\r");
    if (candidates.length === 1) {
      next = candidates[0];
    } else if (candidates.length === 0) {
      console.log(`  ${ERR} store link → ${pc.dim(link.target)} is missing and no folder named ${pc.bold(wanted)} with skills was found under ${homedir()}`);
      console.log(pc.dim(`    point it by hand: ${pc.bold("sks doctor --repair --store <path>")}`));
      return;
    } else {
      console.log(`  ${ERR} store link → ${pc.dim(link.target)} is missing; ${candidates.length} folders could be it:`);
      for (const c of candidates) console.log(pc.dim(`      ${c}`));
      console.log(pc.dim(`    pick one: ${pc.bold("sks doctor --repair --store <path>")}`));
      return;
    }
  }

  const target = next;
  if (!target) return;
  let ok = false;
  try {
    ok = (await stat(target)).isDirectory();
  } catch {
    ok = false;
  }
  if (!ok) {
    console.log(`  ${ERR} ${pc.dim(target)} is not a folder`);
    process.exitCode = 1;
    return;
  }
  await unlink(STORE_SKILLS_DIR);
  await symlink(target, STORE_SKILLS_DIR);
  console.log(`  ${OK} relinked ${pc.dim(STORE_SKILLS_DIR)} → ${target}`);
}

async function sectionPaths(): Promise<void> {
  console.log(pc.bold("Paths"));
  console.log(`  ${label("store")} ${present(STORE_ROOT)} ${pc.dim(STORE_ROOT)}`);
  const link = await skillsDirLink();
  if (link.target) {
    const mark = link.dangling ? ERR : OK;
    const tail = link.dangling ? pc.red("  target missing") : "";
    console.log(`  ${label("skills")} ${mark} ${pc.dim(`${STORE_SKILLS_DIR} → ${link.target}`)}${tail}`);
    if (link.dangling) {
      console.log(pc.dim(`    the folder the store links to is gone. Run ${pc.bold("sks doctor --repair")} to find it, or ${pc.bold("sks doctor --repair --store <path>")}.`));
    }
  } else {
    console.log(`  ${label("skills")} ${present(STORE_SKILLS_DIR)} ${pc.dim(STORE_SKILLS_DIR)}`);
  }
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

async function alwaysSkills(): Promise<ParsedSkill[]> {
  const out: ParsedSkill[] = [];
  if (!existsSync(STORE_SKILLS_DIR)) return out;
  for (const name of await listStoreSkills()) {
    try {
      const parsed = await readSkillMd(storeSkillDir(name));
      if (parsed.frontmatter.always) out.push(parsed);
    } catch {
      // Reported by `sks check`; not this section's job.
    }
  }
  return out;
}

async function sectionAlways(): Promise<void> {
  console.log(pc.bold("Always-on"));
  const config = await readConfig();
  const always = await alwaysSkills();
  console.log(
    `  ${label("rules")} ${pc.dim(
      always.length > 0
        ? always.map((s) => s.frontmatter.name).join(", ")
        : `none — mark one with ${pc.bold("sks always <skill>")}`
    )}`
  );
  const seen = new Set<string>();
  for (const link of config.links) {
    let adapter;
    try {
      adapter = getAdapter(link.agent);
    } catch {
      continue;
    }
    if (!adapter.instructionsFile) continue;
    const file = adapter.instructionsFile(link.path);
    if (seen.has(file)) continue;
    seen.add(file);
    const state = await alwaysBlockState(file, always);
    const mark = state === "ok" ? OK : state === "none" ? MISS : ERR;
    const note =
      state === "ok"
        ? "current"
        : state === "none"
          ? "no block"
          : state === "missing"
            ? "block missing — run sks doctor --repair"
            : "block stale — run sks doctor --repair";
    console.log(`  ${mark} ${pc.bold(adapter.displayName.padEnd(12))} ${pc.dim(file)} ${pc.dim(`(${note})`)}`);
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
  /** With --repair: the folder the store's skills link should point at. */
  store?: string;
}

export async function doctorCommand(options: DoctorOptions = {}): Promise<void> {
  if (options.store && !options.repair) {
    console.error(pc.red("--store only makes sense with --repair"));
    process.exitCode = 1;
    return;
  }
  if (options.repair) {
    console.log(pc.bold("Repair"));
    await repairSkillsLink(options.store);
    try {
      printSyncReport(await sync({ importExisting: true }));
    } catch (err) {
      console.log(`  ${ERR} ${pc.red(err instanceof Error ? err.message : String(err))}`);
      process.exitCode = 1;
    }
    console.log();
  }
  await sectionPaths();
  await sectionLLM(options.verbose ?? false);
  await sectionStore();
  await sectionMirrors();
  await sectionAlways();
  await sectionConflicts();
}
