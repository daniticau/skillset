/**
 * System idle detection for the nightly cycle.
 *
 * The scheduled task fires at 2am but only runs the cycle if the machine is
 * genuinely idle — otherwise we'd steal compute while the user is coding late.
 *
 * Windows: PowerShell inlines a tiny Add-Type P/Invoke to read LASTINPUTINFO,
 * plus Get-Counter for CPU %. Macos/Linux: graceful idle=true fallback (the
 * cycle is scheduler-gated elsewhere and this code path only runs on Windows
 * for now).
 *
 * On probe failure we default to idle=true and include a `reason` — we'd
 * rather run than silently skip forever.
 */

import { spawn } from "node:child_process";

export interface IdleStatus {
  idle: boolean;
  /** Seconds since last user input (keyboard/mouse). undefined on probe fail. */
  inactivitySec?: number;
  /** Recent CPU % (0-100). undefined on probe fail. */
  cpuPct?: number;
  /** Human reason when idle=false, or the diagnostic when probe failed. */
  reason?: string;
}

export interface IdleThresholds {
  /** Machine is busy if CPU > this for the sample window. Default 30. */
  cpuPct: number;
  /** Machine is busy if user input seen within this many minutes. Default 5. */
  inactivityMin: number;
}

const DEFAULT_THRESHOLDS: IdleThresholds = {
  cpuPct: 30,
  inactivityMin: 5,
};

const PS_SCRIPT = `
$signature = @'
[DllImport("user32.dll")]
public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
[StructLayout(LayoutKind.Sequential)]
public struct LASTINPUTINFO {
    public uint cbSize;
    public uint dwTime;
}
'@
$type = Add-Type -MemberDefinition $signature -Name IdleApi -Namespace SkillsetIdle -UsingNamespace System.Runtime.InteropServices -PassThru
$info = New-Object SkillsetIdle.IdleApi+LASTINPUTINFO
$info.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($info)
[void][SkillsetIdle.IdleApi]::GetLastInputInfo([ref]$info)
$idleMs = [Environment]::TickCount - [int64]$info.dwTime
# CPU counter takes ~1s; single-sample is OK
$cpu = (Get-Counter '\Processor(_Total)\% Processor Time' -SampleInterval 1 -MaxSamples 1).CounterSamples[0].CookedValue
Write-Output ("{{""inactivityMs"": {0}, ""cpuPct"": {1}}}" -f [int64]$idleMs, [math]::Round($cpu, 2))
`.trim();

interface ProbePayload {
  inactivityMs: number;
  cpuPct: number;
}

async function runPowershell(script: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { shell: false }
    );
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
      resolve(null);
    }, timeoutMs);
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(null);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void stderr;
      if (code !== 0) return resolve(null);
      resolve(stdout.trim());
    });
  });
}

let cache: { at: number; status: IdleStatus } | null = null;
const CACHE_TTL_MS = 30_000;

export function __clearIdleCache(): void {
  cache = null;
}

/**
 * Probe system idle status. Honors a 30s cache to avoid repeated PowerShell
 * invocations within a single cycle. On non-Windows hosts, returns idle=true
 * with reason="platform-not-supported"; scheduler wiring is Windows-only for now.
 */
export async function isIdle(
  thresholds: Partial<IdleThresholds> = {}
): Promise<IdleStatus> {
  const cfg: IdleThresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };

  if (process.platform !== "win32") {
    return {
      idle: true,
      reason: `idle probe skipped — platform ${process.platform} has no Windows LASTINPUTINFO path`,
    };
  }

  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.status;
  }

  const output = await runPowershell(PS_SCRIPT, 8000);
  if (!output) {
    const status: IdleStatus = {
      idle: true,
      reason: "idle probe failed (powershell not reachable) — running anyway",
    };
    cache = { at: Date.now(), status };
    return status;
  }

  // Grab the JSON line (the script Write-Outputs one line).
  const firstBrace = output.indexOf("{");
  const lastBrace = output.lastIndexOf("}");
  let payload: ProbePayload | null = null;
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      payload = JSON.parse(output.slice(firstBrace, lastBrace + 1)) as ProbePayload;
    } catch {
      payload = null;
    }
  }

  if (!payload) {
    const status: IdleStatus = {
      idle: true,
      reason: `idle probe returned unparseable output: ${output.slice(0, 120)}`,
    };
    cache = { at: Date.now(), status };
    return status;
  }

  const inactivitySec = Math.max(0, payload.inactivityMs / 1000);
  const cpuPct = Math.max(0, payload.cpuPct);
  const inactivityMinActual = inactivitySec / 60;

  const isIdleEnough =
    inactivityMinActual >= cfg.inactivityMin && cpuPct <= cfg.cpuPct;

  const status: IdleStatus = {
    idle: isIdleEnough,
    inactivitySec,
    cpuPct,
    reason: isIdleEnough
      ? undefined
      : `busy — cpu=${cpuPct.toFixed(1)}% (limit ${cfg.cpuPct}), input=${inactivityMinActual.toFixed(1)}min ago (need >= ${cfg.inactivityMin}min)`,
  };
  cache = { at: Date.now(), status };
  return status;
}
