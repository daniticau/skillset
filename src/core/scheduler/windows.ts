/**
 * Windows Task Scheduler wiring.
 *
 * `sks schedule install` creates a user-scope scheduled task (no admin
 * required) that fires `node <dist/cli.js> cycle --nightly --scheduled` at
 * 02:00 daily. StartWhenAvailable=true catches up runs if the machine was
 * asleep. The cycle itself gates on idle + lock, so misfires are safe.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const execFileP = promisify(execFile);

export const TASK_NAME = "Skillset Nightly Cycle";

export interface InstallOptions {
  /** 24h HH:MM. Default "02:00". */
  atTime?: string;
  /** Absolute path to node executable. Defaults to process.execPath. */
  nodePath?: string;
  /** Absolute path to dist/cli.js. Required. */
  cliPath: string;
  /** Try WakeToRun=true; fall back if access denied. Default true. */
  wakeToRun?: boolean;
}

export interface ScheduleStatus {
  installed: boolean;
  taskName: string;
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

/**
 * Build a Windows Task Scheduler XML task definition. CalendarTrigger at
 * `atTime` daily; InteractiveToken logon (user-scope = no admin); action runs
 * `node cli.js cycle --nightly --scheduled` under the current user.
 */
export function buildTaskXml(
  opts: Required<Omit<InstallOptions, "wakeToRun">> & { wakeToRun: boolean }
): string {
  const username = `${process.env.USERDOMAIN ?? ""}\\${process.env.USERNAME ?? ""}`;
  // Build a date component for CalendarTrigger start boundary. Only the time
  // matters for daily schedules; we use today's date.
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const startBoundary = `${yyyy}-${mm}-${dd}T${opts.atTime}:00`;

  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Skillset self-improvement cycle. Fires daily under idle + lock gates.</Description>
    <URI>\\${escapeXml(TASK_NAME)}</URI>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>${startBoundary}</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay>
        <DaysInterval>1</DaysInterval>
      </ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${escapeXml(username)}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>${opts.wakeToRun ? "true" : "false"}</WakeToRun>
    <ExecutionTimeLimit>PT2H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${escapeXml(opts.nodePath)}</Command>
      <Arguments>${escapeXml(`"${opts.cliPath}" cycle --nightly --scheduled`)}</Arguments>
    </Exec>
  </Actions>
</Task>`;
}

/**
 * Install (or replace) the scheduled task. Returns the absolute path to the
 * XML definition file for debugging; throws on hard failure.
 */
export async function installTask(
  options: InstallOptions
): Promise<{ taskName: string; xmlPath: string }> {
  if (process.platform !== "win32") {
    throw new Error(`schedule install only supported on Windows (got ${process.platform})`);
  }
  const atTime = options.atTime ?? "02:00";
  const nodePath = options.nodePath ?? process.execPath;
  const wakeToRun = options.wakeToRun ?? true;

  const xml = buildTaskXml({
    atTime,
    nodePath,
    cliPath: options.cliPath,
    wakeToRun,
  });

  const xmlPath = join(tmpdir(), `skillset-task-${randomUUID()}.xml`);
  await mkdir(tmpdir(), { recursive: true });
  // Task Scheduler expects UTF-16 LE with BOM.
  const buf = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(xml, "utf16le"),
  ]);
  await writeFile(xmlPath, buf);

  try {
    await execFileP("schtasks", [
      "/Create",
      "/TN",
      TASK_NAME,
      "/XML",
      xmlPath,
      "/F",
    ]);
  } catch (err) {
    // If WakeToRun was refused (access-denied), retry without it.
    if (wakeToRun) {
      const retryXml = buildTaskXml({
        atTime,
        nodePath,
        cliPath: options.cliPath,
        wakeToRun: false,
      });
      await writeFile(
        xmlPath,
        Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(retryXml, "utf16le")])
      );
      await execFileP("schtasks", [
        "/Create",
        "/TN",
        TASK_NAME,
        "/XML",
        xmlPath,
        "/F",
      ]);
    } else {
      throw err;
    }
  }

  // Leave xmlPath on disk for user reference? It's in tmpdir so OS will clean it up.
  return { taskName: TASK_NAME, xmlPath };
}

export async function uninstallTask(): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error(`schedule uninstall only supported on Windows`);
  }
  try {
    await execFileP("schtasks", ["/Delete", "/TN", TASK_NAME, "/F"]);
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (msg.toLowerCase().includes("does not exist") || msg.toLowerCase().includes("cannot find")) {
      return; // idempotent — nothing to delete
    }
    throw err;
  }
}

export async function statusTask(): Promise<ScheduleStatus> {
  if (process.platform !== "win32") {
    return { installed: false, taskName: TASK_NAME, reason: "not on Windows" };
  }
  try {
    const { stdout } = await execFileP("schtasks", [
      "/Query",
      "/TN",
      TASK_NAME,
      "/FO",
      "LIST",
      "/V",
    ]);
    return { installed: true, taskName: TASK_NAME, raw: stdout };
  } catch (err) {
    return {
      installed: false,
      taskName: TASK_NAME,
      reason: (err as Error).message,
    };
  }
}

/** Internal — exposed for tests. */
export async function __cleanupXml(xmlPath: string): Promise<void> {
  await rm(xmlPath, { force: true });
}
