/**
 * Shared utilities for shelling out to coding-agent CLIs (claude, codex).
 *
 * These providers use the user's existing subscription rather than an API key
 * by invoking the CLI as a subprocess. We need:
 *  - sync path lookup (defaultLLMConfig runs sync on process start)
 *  - async probe that classifies failure modes (ENOENT vs auth vs rate limit)
 *  - OS-aware spawn flags (Windows needs shell:true to resolve .cmd wrappers)
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, delimiter } from "node:path";

const IS_WIN = process.platform === "win32";
const WIN_EXTS = [".cmd", ".exe", ".bat", ".ps1", ""];

/**
 * Synchronous PATH lookup — used at config-construction time to pick a default
 * provider without async work. Returns the absolute path to the executable, or
 * null if not found. On Windows, searches .cmd/.exe/.bat extensions.
 */
export function whichSync(bin: string): string | null {
  const pathEnv = process.env.PATH ?? "";
  const entries = pathEnv.split(delimiter).filter(Boolean);
  const exts = IS_WIN ? WIN_EXTS : [""];
  for (const entry of entries) {
    for (const ext of exts) {
      const candidate = join(entry, bin + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export interface ProbeResult {
  installed: boolean;
  /** Stdout/stderr from --version, trimmed. */
  version?: string;
  /** Human-readable failure reason when !installed or when version probe failed. */
  reason?: string;
}

/**
 * Run `<bin> --version` with a short timeout. Used by isAvailable() checks so
 * `sks doctor` can tell the user exactly what's wrong.
 */
export async function probeCli(bin: string, timeoutMs = 5000): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, ["--version"], { shell: IS_WIN });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolve({ installed: false, reason: `probe timeout after ${timeoutMs}ms` });
    }, timeoutMs);

    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const code = (err as NodeJS.ErrnoException).code;
      resolve({
        installed: false,
        reason: code === "ENOENT" ? `${bin} not installed` : err.message,
      });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ installed: true, version: (stdout || stderr).trim() });
      } else {
        resolve({
          installed: false,
          reason: `${bin} --version exited ${code}: ${stderr.trim().slice(0, 200)}`,
        });
      }
    });
  });
}

/**
 * Classify CLI stderr into a distinctive reason string that callers can match on.
 * Both claude and codex share similar failure patterns so the logic is shared.
 */
export function classifyCliError(
  stderr: string,
  exitCode: number | null,
  bin: string
): string {
  const low = stderr.toLowerCase();
  if (low.includes("login") || low.includes("not authenticated") || low.includes("sign in")) {
    return `${bin}: not logged in — run \`${bin} login\``;
  }
  if (low.includes("rate limit") || low.includes("429") || low.includes("too many requests")) {
    return `${bin}: rate limited — retry later`;
  }
  if (
    low.includes("quota") ||
    low.includes("exhausted") ||
    low.includes("plan limit") ||
    low.includes("usage limit")
  ) {
    return `${bin}: subscription limit reached`;
  }
  const msg = stderr.trim().slice(0, 200) || `exit ${exitCode ?? "?"}`;
  return `${bin}: ${msg}`;
}

export const IS_WIN_CONST = IS_WIN;
