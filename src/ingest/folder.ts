// Folder extractor forked from nia-cli (src/services/local/extractor.ts, MIT).
// Scope: incremental folder walking with safety skip-lists. The Nia cloud
// upload/registration code (extractSqliteSource, addLocalSource, etc.) is NOT
// forked — we only want the local-read primitives.
//
// Notable delta from upstream: `.jsonl` added to TEXT_EXTENSIONS so Claude Code
// conversation transcripts aren't silently skipped. (Upstream lists Claude Code
// in its catalog but the folder extractor skips `.jsonl` by default — Nia's
// backend indexer appears to handle that file type elsewhere; we need it here.)

import { type Dirent, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { FolderCursor, LocalFileItem, SyncExtractionResult } from "./types.js";

export const TYPE_FOLDER = "folder";
export const MAX_ROWS = 100_000;
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const FOLDER_CURSOR_VERSION = 1;

export const SKIP_DIRS = new Set([
  ".git", ".svn", ".hg", ".bzr",
  "node_modules", ".npm", ".pnpm-store", ".yarn", "bower_components",
  ".next", ".nuxt", ".output", ".svelte-kit", ".parcel-cache", ".cache", ".turbo",
  "__pycache__", "venv", ".venv", "env", ".tox", ".nox",
  ".pytest_cache", ".mypy_cache", ".ruff_cache", ".hypothesis", "htmlcov", ".Python",
  "target", ".gradle", ".m2", "vendor", ".bundle",
  "bin", "obj", "packages", "DerivedData", "Pods", ".build",
  "dist", "build", "out", "output", "release", "debug",
  "coverage", ".nyc_output",
  ".idea", ".vscode", ".atom",
  ".Spotlight-V100", ".Trashes",
  ".terraform", ".vagrant", ".docker", ".kube",
  "logs", "log", "tmp", "temp",
  ".aws", ".ssh",
]);

export const SKIP_EXTENSIONS = new Set([
  ".pem", ".key", ".p12", ".pfx", ".crt", ".cer", ".asc",
  ".pyc", ".pyo", ".pyd", ".egg", ".class", ".jar", ".war", ".ear",
  ".exe", ".pdb", ".nupkg", ".so", ".dylib", ".dll", ".o", ".obj", ".a", ".lib", ".wasm",
  ".sqlite", ".sqlite3", ".db", ".sql",
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".bmp", ".tiff", ".tif", ".psd", ".ai", ".sketch", ".fig",
  ".mp4", ".avi", ".mov", ".wmv", ".webm", ".mkv", ".flv",
  ".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".zip", ".tar", ".gz", ".tgz", ".rar", ".7z", ".bz2", ".xz",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".log", ".tmp", ".temp", ".bak", ".backup", ".old", ".swp", ".swo",
  ".lcov", ".code-workspace",
]);

export const SKIP_FILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb",
  "poetry.lock", "Pipfile.lock", "Gemfile.lock", "composer.lock",
  "Cargo.lock", "gradle.lockfile", "Package.resolved",
  ".DS_Store", "Thumbs.db", "desktop.ini", "ehthumbs.db",
  ".env", ".envrc", ".npmrc", ".pypirc", ".netrc", ".htpasswd",
  "npm-debug.log", "yarn-debug.log", "yarn-error.log", ".pnpm-debug.log", "pip-log.txt",
  ".project", ".classpath", ".coverage",
]);

export const SKIP_PATH_PATTERNS = [
  "credentials", "secrets", ".secret", ".secrets",
  "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
];

export const SKIP_FILENAME_PATTERNS = [
  "openpgp", "pgp_key", "gpg_key",
  "pubkey", "privkey", "public_key", "private_key", "signing_key", "0x",
];

export const ALLOWED_EXTENSIONLESS_FILES = new Set([
  "makefile", "dockerfile", "vagrantfile", "procfile", "gemfile", "rakefile",
  "guardfile", "brewfile", "berksfile", "thorfile", "capfile", "podfile",
  "fastfile", "appfile", "matchfile", "snapfile", "scanfile", "gymfile",
  "deliverfile", "pluginfile", "cmakelists.txt", "justfile", "taskfile",
  "earthfile", "readme", "changelog", "license", "licence",
  "authors", "contributing", "copying", "todo", "news", "history",
]);

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md",
  ".py", ".js", ".ts", ".tsx", ".jsx", ".json", ".jsonl",
  ".yaml", ".yml", ".html", ".css", ".scss", ".less", ".xml", ".csv",
  ".sh", ".bash", ".zsh",
  ".rs", ".go", ".java", ".c", ".cpp", ".h", ".hpp", ".rb",
  ".vue", ".svelte", ".php", ".swift", ".kt", ".scala", ".r", ".sql",
  ".toml", ".ini", ".cfg",
  ".makefile", ".dockerfile", ".gitignore", ".editorconfig",
]);

export function normalizeFolderCursor(
  folderPath: string,
  cursor?: Record<string, unknown> | null
): { cursor: FolderCursor; resetReason?: string } {
  if (!cursor) return { cursor: {}, resetReason: "missing" };

  const typed = cursor as FolderCursor;
  const normalizedRoot = typed.root_path ? path.resolve(typed.root_path) : undefined;
  const normalizedFolder = path.resolve(folderPath);

  if (typed.cursor_version !== FOLDER_CURSOR_VERSION) {
    return { cursor: {}, resetReason: "version_mismatch" };
  }
  if (!normalizedRoot) return { cursor: {}, resetReason: "missing_root_path" };
  if (normalizedRoot !== normalizedFolder) {
    return { cursor: {}, resetReason: "root_path_changed" };
  }

  return {
    cursor: {
      last_mtime: typed.last_mtime,
      last_path: typed.last_path,
      cursor_version: typed.cursor_version,
      root_path: normalizedRoot,
    },
  };
}

function isLikelyBinary(content: Uint8Array): boolean {
  if (content.length === 0) return false;
  for (const byte of content) if (byte === 0) return true;
  let nonText = 0;
  for (const byte of content) {
    if (byte < 8 || (byte >= 14 && byte < 32)) nonText += 1;
  }
  return nonText / content.length > 0.1;
}

function shouldSkipFile(filename: string): { skip: boolean; reason?: string } {
  if (SKIP_FILES.has(filename) || filename.startsWith(".")) return { skip: true };

  const lower = filename.toLowerCase();
  if (SKIP_PATH_PATTERNS.some((p) => lower.includes(p))) {
    return { skip: true, reason: "security_pattern" };
  }
  if (SKIP_FILENAME_PATTERNS.some((p) => lower.includes(p))) {
    return { skip: true, reason: "filename_pattern" };
  }

  const ext = path.extname(lower);
  if (ext && SKIP_EXTENSIONS.has(ext)) return { skip: true, reason: "extension" };
  if (!ext && !ALLOWED_EXTENSIONLESS_FILES.has(lower)) {
    return { skip: true, reason: "no_extension" };
  }
  if (ext && !TEXT_EXTENSIONS.has(ext)) return { skip: true, reason: "extension" };

  return { skip: false };
}

function walkFolder(
  rootPath: string,
  currentPath: string,
  files: LocalFileItem[],
  cursor: FolderCursor,
  maxState: { mtime: number; relativePath: string },
  skippedCounts: Record<string, number>,
  limit: number
): void {
  if (files.length >= limit) return;

  let entries: Dirent[];
  try {
    entries = readdirSync(currentPath, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  } catch {
    skippedCounts.permission_denied = (skippedCounts.permission_denied ?? 0) + 1;
    return;
  }

  for (const entry of entries) {
    if (files.length >= limit) return;
    const abs = path.join(currentPath, entry.name);
    const rel = path.relative(rootPath, abs);

    if (entry.isDirectory()) {
      if (
        SKIP_DIRS.has(entry.name) ||
        entry.name.startsWith(".") ||
        entry.name.endsWith(".egg-info")
      ) continue;
      walkFolder(rootPath, abs, files, cursor, maxState, skippedCounts, limit);
      continue;
    }

    const skip = shouldSkipFile(entry.name);
    if (skip.skip) {
      if (skip.reason) {
        skippedCounts[skip.reason] = (skippedCounts[skip.reason] ?? 0) + 1;
      }
      continue;
    }

    try {
      const stat = statSync(abs);
      const mtime = stat.mtimeMs / 1000;

      if ((cursor.last_mtime ?? 0) > mtime) continue;
      if (
        (cursor.last_mtime ?? 0) === mtime &&
        rel <= (cursor.last_path ?? "")
      ) continue;

      if (stat.size > MAX_FILE_SIZE_BYTES) {
        skippedCounts.too_large = (skippedCounts.too_large ?? 0) + 1;
        continue;
      }

      const sample = readFileSync(abs).subarray(0, 8192);
      if (isLikelyBinary(sample)) {
        skippedCounts.binary = (skippedCounts.binary ?? 0) + 1;
        continue;
      }

      const content = readFileSync(abs, "utf8");
      if (!content.trim()) continue;

      files.push({
        path: rel,
        content,
        metadata: {
          db_type: TYPE_FOLDER,
          extension: path.extname(entry.name).toLowerCase(),
          mtime,
        },
      });

      if (
        mtime > maxState.mtime ||
        (mtime === maxState.mtime && rel > maxState.relativePath)
      ) {
        maxState.mtime = mtime;
        maxState.relativePath = rel;
      }
    } catch {
      // unreadable file — skip silently
    }
  }
}

export function extractFolderIncremental(
  folderPath: string,
  cursor: FolderCursor = {},
  limit = MAX_ROWS
): SyncExtractionResult {
  const normalizedPath = path.resolve(folderPath);
  const files: LocalFileItem[] = [];
  const skippedCounts: Record<string, number> = {
    extension: 0,
    no_extension: 0,
    binary: 0,
    too_large: 0,
    security_pattern: 0,
    filename_pattern: 0,
  };

  const maxState = {
    mtime: cursor.last_mtime ?? 0,
    relativePath: cursor.last_path ?? "",
  };

  walkFolder(normalizedPath, normalizedPath, files, cursor, maxState, skippedCounts, limit);

  const totalSkipped = Object.values(skippedCounts).reduce((t, c) => t + c, 0);

  return {
    files,
    cursor: {
      last_mtime: maxState.mtime,
      last_path: maxState.relativePath,
      cursor_version: FOLDER_CURSOR_VERSION,
      root_path: normalizedPath,
    },
    stats: {
      extracted: files.length,
      db_type: TYPE_FOLDER,
      skipped: totalSkipped,
      skip_details: Object.fromEntries(
        Object.entries(skippedCounts).filter(([, c]) => c > 0)
      ),
    },
  };
}
