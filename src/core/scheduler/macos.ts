/**
 * macOS LaunchAgent wiring for `sks dream`.
 *
 * The agent runs `node <dist/cli.js> dream --run-now --scheduled` once per day
 * at the configured local wall-clock time.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { STORE_ROOT } from "../paths.js";

const execFileP = promisify(execFile);

export const DREAM_LABEL = "com.skillset.dream";
export const DREAM_PLIST_PATH = join(
  homedir(),
  "Library",
  "LaunchAgents",
  `${DREAM_LABEL}.plist`
);

export interface DreamInstallOptions {
  /** 24h HH:MM. Default "02:00". */
  atTime?: string;
  /** Absolute path to node executable. Defaults to process.execPath. */
  nodePath?: string;
  /** Absolute path to dist/cli.js. Required. */
  cliPath: string;
}

export interface DreamScheduleStatus {
  installed: boolean;
  label: string;
  plistPath: string;
  atTime?: string;
  raw?: string;
  reason?: string;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function parseAtTime(atTime: string): { hour: number; minute: number } {
  const match = atTime.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) throw new Error(`invalid time "${atTime}" (expected HH:MM)`);
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function buildDreamPlist(
  opts: Required<DreamInstallOptions>
): string {
  const { hour, minute } = parseAtTime(opts.atTime);
  const stdout = join(STORE_ROOT, "logs", "dream.out.log");
  const stderr = join(STORE_ROOT, "logs", "dream.err.log");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${DREAM_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(opts.nodePath)}</string>
    <string>${escapeXml(opts.cliPath)}</string>
    <string>dream</string>
    <string>--run-now</string>
    <string>--scheduled</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${hour}</integer>
    <key>Minute</key>
    <integer>${minute}</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${escapeXml(stdout)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(stderr)}</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>`;
}

function launchctlDomain(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (uid == null) throw new Error("could not resolve current uid for launchctl");
  return `gui/${uid}`;
}

async function bootoutIfLoaded(): Promise<void> {
  try {
    await execFileP("launchctl", ["bootout", launchctlDomain(), DREAM_PLIST_PATH]);
  } catch {
    // Idempotent: it may not be loaded yet.
  }
}

export async function installDreamLaunchAgent(
  options: DreamInstallOptions
): Promise<{ label: string; plistPath: string; atTime: string }> {
  if (process.platform !== "darwin") {
    throw new Error(`sks dream only supports macOS (got ${process.platform})`);
  }
  const atTime = options.atTime ?? "02:00";
  const nodePath = options.nodePath ?? process.execPath;
  const plist = buildDreamPlist({ atTime, nodePath, cliPath: options.cliPath });

  await mkdir(dirname(DREAM_PLIST_PATH), { recursive: true });
  await mkdir(join(STORE_ROOT, "logs"), { recursive: true });
  await writeFile(DREAM_PLIST_PATH, plist + "\n", "utf8");
  await bootoutIfLoaded();
  await execFileP("launchctl", ["bootstrap", launchctlDomain(), DREAM_PLIST_PATH]);
  await execFileP("launchctl", ["enable", `${launchctlDomain()}/${DREAM_LABEL}`]);

  return { label: DREAM_LABEL, plistPath: DREAM_PLIST_PATH, atTime };
}

export async function uninstallDreamLaunchAgent(): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error(`sks dream only supports macOS (got ${process.platform})`);
  }
  await bootoutIfLoaded();
  await rm(DREAM_PLIST_PATH, { force: true });
}

function atTimeFromPlist(raw: string): string | undefined {
  const hour = raw.match(/<key>Hour<\/key>\s*<integer>(\d+)<\/integer>/)?.[1];
  const minute = raw.match(/<key>Minute<\/key>\s*<integer>(\d+)<\/integer>/)?.[1];
  if (hour == null || minute == null) return undefined;
  return `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

export async function dreamScheduleStatus(): Promise<DreamScheduleStatus> {
  if (process.platform !== "darwin") {
    return {
      installed: false,
      label: DREAM_LABEL,
      plistPath: DREAM_PLIST_PATH,
      reason: `sks dream only supports macOS (got ${process.platform})`,
    };
  }
  if (!existsSync(DREAM_PLIST_PATH)) {
    return {
      installed: false,
      label: DREAM_LABEL,
      plistPath: DREAM_PLIST_PATH,
      reason: "plist not found",
    };
  }

  const plist = await readFile(DREAM_PLIST_PATH, "utf8");
  try {
    const { stdout } = await execFileP("launchctl", [
      "print",
      `${launchctlDomain()}/${DREAM_LABEL}`,
    ]);
    return {
      installed: true,
      label: DREAM_LABEL,
      plistPath: DREAM_PLIST_PATH,
      atTime: atTimeFromPlist(plist),
      raw: stdout,
    };
  } catch (err) {
    return {
      installed: true,
      label: DREAM_LABEL,
      plistPath: DREAM_PLIST_PATH,
      atTime: atTimeFromPlist(plist),
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
