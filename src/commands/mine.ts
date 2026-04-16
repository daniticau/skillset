import pc from "picocolors";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { STORE_ROOT } from "../core/paths.js";
import {
  readAllSessions,
  getSessionStats,
  extractSignal,
} from "../mine/index.js";
import { deduplicateAndRank } from "../mine/dedup.js";
import { llmExtractFromSessions } from "../mine/llm-extract.js";
import { synthesizeSkills, writeDraftSkill, DRAFTS_DIR } from "../mine/synthesize.js";
import {
  defaultLLMConfig,
  isAvailable,
  detectEmbeddingModel,
} from "../mine/llm/index.js";
import {
  readMineState,
  writeMineState,
  finalizeRun,
  markProcessed,
  needsProcessing,
  sessionFileHash,
} from "../mine/state.js";
import type { Nugget, NuggetCategory, NuggetCluster } from "../mine/types.js";

const NUGGETS_DIR = join(STORE_ROOT, "nuggets");
const NUGGETS_FILE = join(NUGGETS_DIR, "nuggets.json");
const CLUSTERS_FILE = join(NUGGETS_DIR, "clusters.json");

export interface MineOptions {
  project?: string;
  verbose?: boolean;
  llm?: boolean;
  synthesize?: boolean;
  force?: boolean;
  dryRun?: boolean;
}

function categoryLabel(cat: string): string {
  const labels: Record<string, string> = {
    correction: pc.red("correction"),
    preference: pc.blue("preference"),
    rejection: pc.yellow("rejection"),
    workflow: pc.green("workflow"),
    "tool-pattern": pc.cyan("tool-pattern"),
    topic: pc.magenta("topic"),
    style: pc.blue("style"),
    "anti-pattern": pc.red("anti-pattern"),
  };
  return labels[cat] ?? cat;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

async function loadExistingNuggets(): Promise<Nugget[]> {
  if (!existsSync(NUGGETS_FILE)) return [];
  try {
    const raw = await readFile(NUGGETS_FILE, "utf8");
    const parsed = JSON.parse(raw) as Nugget[];
    // Backfill new required fields for legacy data
    return parsed.map((n) => ({
      ...n,
      source: n.source ?? "heuristic",
      createdAt: n.createdAt ?? new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

async function saveNuggets(nuggets: Nugget[]): Promise<void> {
  await mkdir(NUGGETS_DIR, { recursive: true });
  await writeFile(NUGGETS_FILE, JSON.stringify(nuggets, null, 2) + "\n", "utf8");
}

async function saveClusters(clusters: NuggetCluster[]): Promise<void> {
  await mkdir(NUGGETS_DIR, { recursive: true });
  await writeFile(CLUSTERS_FILE, JSON.stringify(clusters, null, 2) + "\n", "utf8");
}

function mergeNuggets(existing: Nugget[], incoming: Nugget[]): Nugget[] {
  const map = new Map<string, Nugget>();
  for (const n of existing) map.set(n.id, n);
  for (const n of incoming) {
    const prev = map.get(n.id);
    if (!prev) {
      map.set(n.id, n);
      continue;
    }
    // Merge evidence, keep higher confidence, preserve LLM validation
    const mergedEvidence = [...prev.evidence];
    for (const ev of n.evidence) {
      if (!mergedEvidence.some((e) => e.sessionId === ev.sessionId && e.userMessage === ev.userMessage)) {
        mergedEvidence.push(ev);
      }
    }
    map.set(n.id, {
      ...prev,
      ...n,
      evidence: mergedEvidence.slice(0, 5),
      confidence: Math.max(prev.confidence, n.confidence),
      validatedByLLM: prev.validatedByLLM || n.validatedByLLM,
    });
  }
  return [...map.values()];
}

export async function mineCommand(options: MineOptions): Promise<void> {
  const stats = getSessionStats();
  if (stats.userSessions === 0) {
    console.log(pc.dim("no session data found in ~/.claude/projects/"));
    return;
  }

  const subagentNote =
    stats.sidechainSessions > 0
      ? ` (${stats.sidechainSessions} subagent runs skipped)`
      : "";
  console.log(
    pc.dim(
      `scanning ${stats.projects} projects, ${stats.userSessions} user sessions${subagentNote} ` +
        `(${(stats.totalSizeBytes / 1024 / 1024).toFixed(1)} MB)…`
    )
  );

  const sessions = readAllSessions(options.project);
  if (sessions.length === 0) {
    console.log(pc.dim("no readable sessions found"));
    return;
  }

  // Incremental: skip sessions already processed (unless --force)
  let mineState = await readMineState();
  const targetStage = options.llm ? "llm-validated" : "heuristic";
  const sessionsToProcess = options.force
    ? sessions
    : sessions.filter((s) => {
        const hash = sessionFileHash(s.filePath);
        if (!hash) return true;
        return needsProcessing(s.sessionId, hash, mineState, targetStage);
      });

  if (sessionsToProcess.length === 0 && !options.dryRun) {
    console.log(
      pc.dim(
        `all ${sessions.length} sessions already processed at stage "${targetStage}" (use --force to reprocess)`
      )
    );
    return;
  }

  if (options.dryRun) {
    console.log(
      pc.yellow(
        `dry run: would process ${sessionsToProcess.length} of ${sessions.length} sessions at stage "${targetStage}"`
      )
    );
    return;
  }

  if (sessionsToProcess.length < sessions.length) {
    console.log(
      pc.dim(
        `incremental: processing ${sessionsToProcess.length} of ${sessions.length} sessions (rest cached)`
      )
    );
  }

  // Stage 1: heuristic extraction
  console.log(pc.dim("running heuristic extraction…"));
  const { nuggets: heuristicNuggets, summary } = extractSignal(sessionsToProcess);
  console.log(
    pc.green(
      `✓ heuristic: ${summary.sessionsRead} sessions, ${summary.messagesProcessed} messages → ${heuristicNuggets.length} nuggets`
    )
  );

  let allNuggets = [...heuristicNuggets];

  // Stage 2: LLM extraction (if --llm)
  if (options.llm) {
    const config = defaultLLMConfig();
    const avail = await isAvailable(config);

    if (!avail.reachable) {
      console.log(
        pc.yellow(
          `⚠ LLM unreachable at ${config.baseUrl} (${avail.reason ?? "no response"}) — falling back to heuristic-only`
        )
      );
    } else if (!avail.modelPresent) {
      console.log(
        pc.yellow(
          `⚠ Model "${config.model}" not found in Ollama. Available: ${avail.models.join(", ") || "none"}`
        )
      );
      console.log(pc.yellow("  Falling back to heuristic-only."));
    } else {
      console.log(pc.dim(`running LLM extraction via ${config.model}…`));

      const { nuggets: llmNuggets, progress } = await llmExtractFromSessions(
        sessionsToProcess,
        heuristicNuggets,
        config,
        {
          concurrency: 3,
          onProgress: (p) => {
            if (p.windowsProcessed % 5 === 0 || p.windowsProcessed === p.windowsTotal) {
              process.stderr.write(
                `\r  windows ${p.windowsProcessed}/${p.windowsTotal} · signals ${p.signalsExtracted} · errors ${p.parseFailures}   `
              );
            }
          },
        }
      );
      process.stderr.write("\n");

      console.log(
        pc.green(
          `✓ LLM: ${progress.windowsProcessed} windows → ${llmNuggets.length} nuggets (${progress.parseFailures} parse failures)`
        )
      );
      allNuggets = [...allNuggets, ...llmNuggets];
    }
  }

  // Merge with existing nuggets file (skip merge on --force: rebuild clean)
  const existing = options.force ? [] : await loadExistingNuggets();
  const merged = mergeNuggets(existing, allNuggets);
  await saveNuggets(merged);

  // Stage 3: semantic dedup + ranking
  // Auto-detect an Ollama embedding model — embeddings work far better than
  // TF-IDF for short signals, and are worth using whenever available (no --llm
  // flag required).
  const clusterConfig = defaultLLMConfig();
  const embedModel = await detectEmbeddingModel(clusterConfig).catch(() => undefined);
  if (embedModel && !clusterConfig.embeddingModel) {
    clusterConfig.embeddingModel = embedModel;
  }
  const usingEmbeddings = !!clusterConfig.embeddingModel;
  console.log(
    pc.dim(
      usingEmbeddings
        ? `clustering and ranking nuggets (embeddings: ${clusterConfig.embeddingModel})…`
        : "clustering and ranking nuggets (tf-idf fallback — no ollama embedding model found)…"
    )
  );
  const clusters = await deduplicateAndRank(merged, {
    useEmbeddings: usingEmbeddings,
    llmConfig: clusterConfig,
  });
  await saveClusters(clusters);
  console.log(pc.green(`✓ ${merged.length} nuggets → ${clusters.length} clusters`));

  // Update state
  for (const s of sessionsToProcess) {
    const hash = sessionFileHash(s.filePath);
    if (!hash) continue;
    mineState = markProcessed(mineState, s.sessionId, hash, targetStage);
  }
  mineState = finalizeRun(mineState);
  await writeMineState(mineState);

  // Category breakdown
  const byCategory: Record<string, number> = {};
  for (const n of merged) byCategory[n.category] = (byCategory[n.category] ?? 0) + 1;
  console.log();
  for (const [cat, count] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${categoryLabel(cat).padEnd(28)} ${count}`);
  }

  // Top clusters
  console.log();
  console.log(pc.bold(`Top ${Math.min(10, clusters.length)} clusters:`));
  for (const cluster of clusters.slice(0, 10)) {
    const n = cluster.canonical;
    const label = categoryLabel(n.category);
    const projects = cluster.projects.length > 0 ? pc.dim(` [${cluster.projects.slice(0, 3).join(", ")}]`) : "";
    const score = pc.dim(`(score ${cluster.score.toFixed(2)}, ${cluster.members.length}x)`);
    const src = n.validatedByLLM ? pc.magenta("llm") : pc.gray("heu");
    console.log(`  ${label} ${src}${projects} ${score}`);
    console.log(`    ${truncate(n.signal.replace(/\n/g, " ").trim(), 120)}`);
    if (options.verbose && n.evidence[0]) {
      console.log(pc.dim(`    "${truncate(n.evidence[0].userMessage, 100)}"`));
    }
  }

  console.log();
  console.log(pc.dim(`nuggets → ${NUGGETS_FILE}`));
  console.log(pc.dim(`clusters → ${CLUSTERS_FILE}`));

  // Stage 4: synthesis (if --synthesize)
  if (options.synthesize) {
    const avail = await isAvailable(clusterConfig);
    if (!avail.reachable || !avail.modelPresent) {
      console.log(pc.yellow(`⚠ LLM unavailable — cannot synthesize skills`));
      return;
    }

    console.log();
    console.log(pc.dim("synthesizing draft skills…"));

    const skills = await synthesizeSkills(clusters, clusterConfig, {
      maxSkills: 10,
      minClusterMembers: 2,
      onProgress: (done, total) => {
        process.stderr.write(`\r  synthesizing ${done}/${total}   `);
      },
    });
    process.stderr.write("\n");

    for (const skill of skills) {
      const path = await writeDraftSkill(skill);
      console.log(pc.green(`✓ draft`) + ` ${pc.bold(skill.name)}  ${pc.dim(path)}`);
      console.log(pc.dim(`    ${skill.description}`));
    }
    console.log();
    console.log(pc.dim(`${skills.length} drafts → ${DRAFTS_DIR}`));
    console.log(pc.dim(`run ${pc.bold("skillset drafts")} to review, ${pc.bold("skillset promote <name>")} to publish`));
  }
}
