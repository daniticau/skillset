/**
 * Resolve a remote skill source into a local directory that holds SKILL.md.
 *
 * Accepted forms:
 *   owner/repo                                   GitHub shorthand
 *   https://github.com/owner/repo                whole repo (one skill, or --skill)
 *   https://github.com/owner/repo/tree/ref/path  a subtree
 *   https://github.com/owner/repo/blob/ref/path/SKILL.md
 *   https://raw.githubusercontent.com/.../SKILL.md
 *   https://skills.sh/owner/repo[/skill]         skills.sh listing
 *   https://x.com/user/status/id                 a tweet that links to one of the above
 *   any https URL that ends in .md               fetched as SKILL.md
 *
 * Network access goes through one injectable `fetch` so tests run offline.
 */

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> }
) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;

export interface RemoteResolveOptions {
  /** Pick one skill by directory name when a repo holds several. */
  skill?: string;
  fetch?: FetchLike;
  /** GitHub token for the API calls; raises the unauthenticated rate limit. */
  token?: string;
}

export interface ResolvedRemoteSkill {
  /** Temporary directory with SKILL.md and its sibling files. */
  dir: string;
  /** Where it came from, for logs and history. */
  origin: string;
  cleanup(): Promise<void>;
}

export class RemoteSourceError extends Error {
  /** Set when a tweet was fetched but held no skill link. */
  tweetText?: string;
}

export type RemoteTarget =
  | { kind: "github"; owner: string; repo: string; ref?: string; path?: string; skill?: string }
  | { kind: "raw"; url: string }
  | { kind: "tweet"; user: string; id: string };

// owner/repo. Neither half may start with a dot, which also rules out ./x and ../x.
const SHORTHAND = /^(?!\.)[A-Za-z0-9_.-]+\/(?!\.)[A-Za-z0-9_.-]+$/;
const IGNORED_PARTS = new Set([".git", "node_modules", "__pycache__", ".DS_Store"]);
const MAX_FILE_BYTES = 1_000_000;
const MAX_FILES = 200;

export function isRemoteSource(source: string): boolean {
  if (/^https?:\/\//i.test(source)) return true;
  if (existsSync(source)) return false;
  return SHORTHAND.test(source);
}

export function parseRemoteSource(source: string): RemoteTarget {
  if (SHORTHAND.test(source) && !existsSync(source)) {
    const [owner, repo] = source.split("/") as [string, string];
    return { kind: "github", owner, repo };
  }
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new RemoteSourceError(`not a URL or owner/repo: ${source}`);
  }
  const host = url.hostname.replace(/^www\./, "");
  const segments = url.pathname.split("/").filter(Boolean);

  if (host === "github.com") {
    const [owner, repo, mode, ref, ...rest] = segments;
    if (!owner || !repo) throw new RemoteSourceError(`GitHub URL needs owner/repo: ${source}`);
    const cleanRepo = repo.replace(/\.git$/, "");
    if (mode === "tree" || mode === "blob") {
      const path = mode === "blob" && rest[rest.length - 1] === "SKILL.md" ? rest.slice(0, -1) : rest;
      return { kind: "github", owner, repo: cleanRepo, ref, path: path.join("/") || undefined };
    }
    return { kind: "github", owner, repo: cleanRepo };
  }

  if (host === "raw.githubusercontent.com") {
    return { kind: "raw", url: source };
  }

  if (host === "skills.sh") {
    const [owner, repo, skill] = segments;
    if (!owner || !repo) throw new RemoteSourceError(`skills.sh URL needs owner/repo: ${source}`);
    return { kind: "github", owner, repo, skill };
  }

  if (host === "x.com" || host === "twitter.com" || host === "mobile.twitter.com") {
    const [user, status, id] = segments;
    if (status !== "status" || !user || !id) {
      throw new RemoteSourceError(`tweet URL must look like https://x.com/<user>/status/<id>`);
    }
    return { kind: "tweet", user, id: id.replace(/\D.*$/, "") };
  }

  if (/\.md$/i.test(url.pathname)) {
    return { kind: "raw", url: source };
  }

  throw new RemoteSourceError(
    `don't know how to fetch a skill from ${source}. Try a GitHub repo, a skills.sh page, a raw SKILL.md, or a tweet that links to one.`
  );
}

async function fetchText(fetchImpl: FetchLike, url: string, headers: Record<string, string>): Promise<string> {
  const res = await fetchImpl(url, { headers });
  if (!res.ok) {
    const hint =
      res.status === 403 && url.includes("api.github.com")
        ? " (GitHub rate limit? set GITHUB_TOKEN)"
        : "";
    throw new RemoteSourceError(`GET ${url} → ${res.status}${hint}`);
  }
  return res.text();
}

async function fetchJson(fetchImpl: FetchLike, url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetchImpl(url, { headers });
  if (!res.ok) {
    const hint =
      res.status === 403 && url.includes("api.github.com")
        ? " (GitHub rate limit? set GITHUB_TOKEN)"
        : "";
    throw new RemoteSourceError(`GET ${url} → ${res.status}${hint}`);
  }
  return res.json();
}

interface TreeEntry {
  path: string;
  type: string;
  size?: number;
}

function skillDirOf(path: string): string | null {
  if (path === "SKILL.md") return "";
  if (path.endsWith("/SKILL.md")) return path.slice(0, -"/SKILL.md".length);
  return null;
}

function underDir(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`);
}

async function resolveGitHub(
  target: Extract<RemoteTarget, { kind: "github" }>,
  options: RemoteResolveOptions,
  fetchImpl: FetchLike
): Promise<ResolvedRemoteSkill> {
  const headers: Record<string, string> = { "User-Agent": "skillset-cli" };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const { owner, repo } = target;

  let ref = target.ref;
  if (!ref) {
    try {
      const info = (await fetchJson(
        fetchImpl,
        `https://api.github.com/repos/${owner}/${repo}`,
        headers
      )) as { default_branch?: string };
      ref = info.default_branch || "HEAD";
    } catch {
      ref = "HEAD";
    }
  }

  const tree = (await fetchJson(
    fetchImpl,
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    headers
  )) as { tree?: TreeEntry[]; truncated?: boolean };
  const entries = tree.tree ?? [];

  let skillDirs = entries
    .filter((e) => e.type === "blob")
    .map((e) => skillDirOf(e.path))
    .filter((d): d is string => d !== null)
    .filter((d) => !d.split("/").some((part) => IGNORED_PARTS.has(part)));

  if (target.path !== undefined) {
    const p = target.path.replace(/\/+$/, "");
    skillDirs = skillDirs.filter((d) => d === p || d.startsWith(`${p}/`));
  }
  const wanted = options.skill ?? target.skill;
  if (wanted) {
    skillDirs = skillDirs.filter((d) => basename(d) === wanted);
  }

  if (skillDirs.length === 0) {
    const where = target.path ? `under ${target.path} in` : "in";
    const which = wanted ? ` named "${wanted}"` : "";
    throw new RemoteSourceError(`no SKILL.md${which} found ${where} ${owner}/${repo}@${ref}`);
  }
  if (skillDirs.length > 1) {
    const names = skillDirs.map((d) => `  ${basename(d) || "(root)"}  ${d || "."}`).join("\n");
    throw new RemoteSourceError(
      `${owner}/${repo} holds ${skillDirs.length} skills. Pick one with --skill <name>:\n${names}`
    );
  }

  const dir = skillDirs[0]!;
  const files = entries.filter(
    (e) =>
      e.type === "blob" &&
      (dir === "" ? true : underDir(e.path, dir)) &&
      !e.path.split("/").some((part) => IGNORED_PARTS.has(part)) &&
      (e.size ?? 0) <= MAX_FILE_BYTES
  );
  // A root-level SKILL.md repo can be a whole project. Take the skill file and
  // its conventional sibling folders only, never the entire tree.
  const scoped =
    dir === ""
      ? files.filter((e) => /^(SKILL\.md|(references|scripts|assets)\/)/.test(e.path))
      : files;
  if (scoped.length > MAX_FILES) {
    throw new RemoteSourceError(`skill at ${dir || "."} has ${scoped.length} files; refusing more than ${MAX_FILES}`);
  }

  const tmp = await mkdtemp(join(tmpdir(), "skillset-remote-"));
  const cleanup = async () => rm(tmp, { recursive: true, force: true });
  try {
    for (const entry of scoped) {
      const rel = dir === "" ? entry.path : entry.path.slice(dir.length + 1);
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${entry.path}`;
      const text = await fetchText(fetchImpl, rawUrl, headers);
      const dest = join(tmp, rel);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, text, "utf8");
    }
  } catch (err) {
    await cleanup();
    throw err;
  }
  return {
    dir: tmp,
    origin: `github.com/${owner}/${repo}@${ref}${dir ? `/${dir}` : ""}`,
    cleanup,
  };
}

async function resolveRaw(url: string, fetchImpl: FetchLike): Promise<ResolvedRemoteSkill> {
  const text = await fetchText(fetchImpl, url, { "User-Agent": "skillset-cli" });
  const tmp = await mkdtemp(join(tmpdir(), "skillset-remote-"));
  await writeFile(join(tmp, "SKILL.md"), text, "utf8");
  return { dir: tmp, origin: url, cleanup: async () => rm(tmp, { recursive: true, force: true }) };
}

const URL_IN_TEXT = /https?:\/\/[^\s)\]}>"']+/g;

async function resolveTweet(
  target: Extract<RemoteTarget, { kind: "tweet" }>,
  options: RemoteResolveOptions,
  fetchImpl: FetchLike
): Promise<ResolvedRemoteSkill> {
  const api = `https://api.fxtwitter.com/${target.user}/status/${target.id}`;
  const data = (await fetchJson(fetchImpl, api, { "User-Agent": "skillset-cli" })) as {
    tweet?: { text?: string; quote?: { text?: string } };
  };
  const text = [data.tweet?.text ?? "", data.tweet?.quote?.text ?? ""].filter(Boolean).join("\n");
  if (!text) throw new RemoteSourceError(`could not read tweet ${target.user}/${target.id}`);

  for (const url of text.match(URL_IN_TEXT) ?? []) {
    const clean = url.replace(/[.,;:!?]+$/, "");
    let nested: RemoteTarget;
    try {
      nested = parseRemoteSource(clean);
    } catch {
      continue;
    }
    if (nested.kind === "tweet") continue;
    const resolved = await resolveTarget(nested, options, fetchImpl);
    return { ...resolved, origin: `${resolved.origin} (via https://x.com/${target.user}/status/${target.id})` };
  }

  const err = new RemoteSourceError(
    `the tweet links to no skill. Its text:\n\n${text}\n\nTo turn that text into a skill: sks add <tweet-url> --build`
  );
  err.tweetText = text;
  throw err;
}

async function resolveTarget(
  target: RemoteTarget,
  options: RemoteResolveOptions,
  fetchImpl: FetchLike
): Promise<ResolvedRemoteSkill> {
  switch (target.kind) {
    case "github":
      return resolveGitHub(target, options, fetchImpl);
    case "raw":
      return resolveRaw(target.url, fetchImpl);
    case "tweet":
      return resolveTweet(target, options, fetchImpl);
  }
}

export async function resolveRemoteSkill(
  source: string,
  options: RemoteResolveOptions = {}
): Promise<ResolvedRemoteSkill> {
  const fetchImpl: FetchLike =
    options.fetch ?? ((globalThis.fetch as unknown as FetchLike | undefined) ?? failNoFetch);
  const token = options.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  return resolveTarget(parseRemoteSource(source), { ...options, token }, fetchImpl);
}

const failNoFetch: FetchLike = async () => {
  throw new RemoteSourceError("this Node has no global fetch; use Node 20 or newer");
};
