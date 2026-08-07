/**
 * Version history for the canonical store.
 *
 * Every mutation (add, edit, build, remove) commits the skills directory, so the
 * store has a recoverable history the user owns. Safe when git is unavailable
 * (no-op) and when nothing changed (no-op).
 */

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { STORE_ROOT, STORE_SKILLS_DIR } from "../paths.js";

const execFileP = promisify(execFile);

/**
 * Where the history actually lives.
 *
 * `~/.skillset/skills` is commonly a symlink to a directory the user keeps
 * elsewhere. Git stores a symlink as a link (mode 120000), never as the tree
 * behind it, so committing in ~/.skillset records the *pointer* and none of the
 * skill content — the history looks populated while holding nothing. When the
 * skills dir is a link, run git inside the real directory instead.
 */
export interface AuditRepo {
  /** Directory git runs in. */
  root: string;
  /** Pathspec covering skill content, relative to `root`. */
  skillsPathspec: string;
  /** True when `root` is the store itself (so sibling state.json is committable). */
  isStoreRoot: boolean;
}

export function resolveAuditRepo(): AuditRepo {
  try {
    if (lstatSync(STORE_SKILLS_DIR).isSymbolicLink()) {
      return {
        root: realpathSync(STORE_SKILLS_DIR),
        skillsPathspec: ".",
        isStoreRoot: false,
      };
    }
  } catch {
    // No skills dir yet — fall back to the store root.
  }
  return { root: STORE_ROOT, skillsPathspec: "skills", isStoreRoot: true };
}

async function runGit(
  args: string[],
  cwd: string = STORE_ROOT
): Promise<{ stdout: string; stderr: string } | null> {
  try {
    return await execFileP("git", ["-C", cwd, ...args]);
  } catch {
    return null;
  }
}

/**
 * Make sure the history repo exists, creating it when the skills directory is
 * not under version control yet. Without this an unbacked store stays unbacked,
 * and skill deletions are unrecoverable.
 */
export async function ensureAuditRepo(repo: AuditRepo = resolveAuditRepo()): Promise<boolean> {
  if (!existsSync(repo.root)) return false;
  const inRepo = await runGit(["rev-parse", "--git-dir"], repo.root);
  if (inRepo) return true;
  const init = await runGit(["init"], repo.root);
  return init !== null;
}

/** Run `git commit -F -` and pipe the message via stdin to dodge shell quoting. */
async function commitWithMessage(message: string, cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("git", ["-C", cwd, "commit", "-F", "-"]);
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

/** Ensure `git config user.name` + `user.email` are set locally on the repo. */
async function ensureGitIdentity(cwd: string): Promise<void> {
  const name = await runGit(["config", "--local", "user.name"], cwd);
  if (!name || !name.stdout.trim()) {
    await runGit(["config", "--local", "user.name", "skillset"], cwd);
  }
  const email = await runGit(["config", "--local", "user.email"], cwd);
  if (!email || !email.stdout.trim()) {
    await runGit(["config", "--local", "user.email", "skillset@local"], cwd);
  }
}

async function hasChanges(repo: AuditRepo): Promise<boolean> {
  const res = await runGit(
    ["status", "--porcelain", "--", repo.skillsPathspec],
    repo.root
  );
  if (!res) return false;
  return res.stdout.trim().length > 0;
}

/**
 * Commit the current state of the canonical store.
 *
 * `summary` becomes the commit subject (e.g. `add: ship-it-gate`). Returns
 * { sha } on success, or null when git is unavailable or nothing changed.
 */
export async function commitStoreChange(
  summary: string
): Promise<{ sha: string } | null> {
  const repo = resolveAuditRepo();
  if (!(await ensureAuditRepo(repo))) return null;
  await ensureGitIdentity(repo.root);

  if (!(await hasChanges(repo))) return null;

  const paths = repo.isStoreRoot ? ["skills", "state.json"] : [repo.skillsPathspec];
  for (const path of paths) {
    if (path === "." || existsSync(join(repo.root, path))) {
      await runGit(["add", "--", path], repo.root);
    }
  }

  const committed = await commitWithMessage(summary, repo.root);
  if (!committed) return null;

  const shaRes = await runGit(["rev-parse", "HEAD"], repo.root);
  const sha = shaRes?.stdout.trim() ?? "";
  return sha ? { sha } : null;
}
