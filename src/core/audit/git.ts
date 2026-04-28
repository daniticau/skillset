/**
 * Audit-trail git helper.
 *
 * Called at the end of every skillset cycle (deep-dive, nightly, cleanup) to
 * stage + commit changes to the canonical store's internal `.git`. Gives the
 * user a browseable history of what the daily loop did, without adding any
 * dependency on external storage.
 *
 * Safe when git is not available (no-op). Safe when nothing changed (no-op).
 */

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { STORE_ROOT } from "../paths.js";
import type { CycleKind } from "../config.js";

const execFileP = promisify(execFile);

export interface CycleCreatedSkill {
  name: string;
  description?: string;
}

export interface CycleEditedSkill {
  name: string;
  rationale?: string;
}

export interface CycleMergedSkills {
  from: string[];
  into: string;
}

export interface CyclePrunedSkill {
  name: string;
  reason: string;
}

export interface CycleReport {
  kind: CycleKind;
  cycleId: string;
  durationMs: number;
  llmProvider: string;
  createdSkills: CycleCreatedSkill[];
  editedSkills: CycleEditedSkill[];
  mergedSkills: CycleMergedSkills[];
  prunedSkills: CyclePrunedSkill[];
}

async function runGit(args: string[]): Promise<{ stdout: string; stderr: string } | null> {
  try {
    return await execFileP("git", ["-C", STORE_ROOT, ...args]);
  } catch {
    return null;
  }
}

/** Run `git commit -F -` and pipe the message via stdin to dodge shell quoting. */
async function commitWithMessage(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("git", ["-C", STORE_ROOT, "commit", "-F", "-"]);
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", () => resolve(false));
    child.on("close", (code) => {
      void stderr;
      resolve(code === 0);
    });
    child.stdin.write(message);
    child.stdin.end();
  });
}

/** Ensure `git config user.name` + `user.email` are set locally on the store. */
async function ensureGitIdentity(): Promise<void> {
  const name = await runGit(["config", "--local", "user.name"]);
  if (!name || !name.stdout.trim()) {
    await runGit(["config", "--local", "user.name", "skillset"]);
  }
  const email = await runGit(["config", "--local", "user.email"]);
  if (!email || !email.stdout.trim()) {
    await runGit(["config", "--local", "user.email", "skillset@local"]);
  }
}

/**
 * Returns true if staging + commit should proceed — i.e., there are changes
 * under ~/.skillset/skills that we care about. State-only
 * changes are filtered out here to avoid churn commits; they still land on the
 * NEXT meaningful cycle.
 */
async function hasMeaningfulChanges(): Promise<boolean> {
  const res = await runGit(["status", "--porcelain", "--", "skills"]);
  if (!res) return false;
  return res.stdout.trim().length > 0;
}

function humanizeDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  return `${m}m${rem}s`;
}

function topicsLine(names: string[], max = 3): string {
  if (names.length === 0) return "";
  const shown = names.slice(0, max).join(", ");
  const extra = names.length - max;
  return extra > 0 ? `${shown}, +${extra}` : shown;
}

export function formatCycleCommitMessage(report: CycleReport): string {
  const counts = [
    `+${report.createdSkills.length} skills`,
    report.editedSkills.length > 0 ? `edited ${report.editedSkills.length}` : null,
    report.mergedSkills.length > 0 ? `merged ${report.mergedSkills.length}` : null,
    report.prunedSkills.length > 0 ? `pruned ${report.prunedSkills.length}` : null,
  ].filter((s): s is string => !!s);

  const mergeTopics = topicsLine(report.mergedSkills.map((m) => m.into));
  const pruneTopics = topicsLine(report.prunedSkills.map((p) => p.name));

  const summary = counts.join(", ");
  const annotations: string[] = [];
  if (mergeTopics) annotations.push(`merged: ${mergeTopics}`);
  if (pruneTopics) annotations.push(`pruned: ${pruneTopics}`);

  const subject = `cycle(${report.kind}): ${summary}${
    annotations.length > 0 ? " — " + annotations.join(" / ") : ""
  }`;

  const sections: string[] = [];

  if (report.createdSkills.length > 0) {
    const lines = [
      "Created:",
      ...report.createdSkills.map(
        (s) => `- ${s.name}${s.description ? `: ${s.description}` : ""}`
      ),
    ];
    sections.push(lines.join("\n"));
  }
  if (report.editedSkills.length > 0) {
    const lines = [
      "Edited:",
      ...report.editedSkills.map(
        (s) => `- ${s.name}${s.rationale ? `: ${s.rationale}` : ""}`
      ),
    ];
    sections.push(lines.join("\n"));
  }
  if (report.mergedSkills.length > 0) {
    const lines = [
      "Merged:",
      ...report.mergedSkills.map((m) => `- ${m.from.join(" + ")} → ${m.into}`),
    ];
    sections.push(lines.join("\n"));
  }
  if (report.prunedSkills.length > 0) {
    const lines = [
      "Pruned:",
      ...report.prunedSkills.map((p) => `- ${p.name} (reason: ${p.reason})`),
    ];
    sections.push(lines.join("\n"));
  }

  const trailer = `LLM: ${report.llmProvider} | duration: ${humanizeDuration(report.durationMs)} | cycle-id: ${report.cycleId}`;

  return [subject, "", ...sections, trailer].filter(Boolean).join("\n\n");
}

/**
 * Stage and commit the outcome of a cycle. Skips cleanly when:
 *   - ~/.skillset/.git doesn't exist (store was init'd without git),
 *   - there are no changes under skills/,
 *   - git is unavailable on the host.
 * Returns { sha } on success, null on skip.
 */
export async function stageAndCommitCycle(
  report: CycleReport
): Promise<{ sha: string } | null> {
  if (!existsSync(join(STORE_ROOT, ".git"))) return null;
  await ensureGitIdentity();

  if (!(await hasMeaningfulChanges())) return null;

  // Stage skills and state.json independently. `git add <path>`
  // errors when the path doesn't exist, so we add one at a time and ignore
  // ENOENT-style failures.
  for (const path of ["skills", "state.json"]) {
    if (existsSync(join(STORE_ROOT, path))) {
      await runGit(["add", "--", path]);
    }
  }

  const message = formatCycleCommitMessage(report);
  const committed = await commitWithMessage(message);
  if (!committed) return null;

  const shaRes = await runGit(["rev-parse", "HEAD"]);
  const sha = shaRes?.stdout.trim() ?? "";
  return sha ? { sha } : null;
}
