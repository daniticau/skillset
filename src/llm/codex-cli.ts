/**
 * Codex CLI provider — shells out to `codex exec <prompt>` for a single-turn
 * completion under the user's existing Codex subscription.
 *
 * Contract assumption (verified by runtime probe):
 *   - `codex exec "prompt"` emits the model response to stdout, exit 0.
 *   - `codex --help` is the canonical reference if flags drift.
 *
 * Fallback role: used when `claude` CLI is missing. Behavior, timeouts, and
 * error classification mirror claude-cli for consistency.
 */

import { spawn } from "node:child_process";
import { mkdir, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  LLMConfig,
  ChatOptions,
  CompletionResult,
  ChatMessage,
} from "./client.js";
import { STORE_ROOT } from "../core/paths.js";
import { classifyCliError, probeCli, IS_WIN_CONST } from "./cli-detect.js";

const STDIN_THRESHOLD = 2048;
const PROBE_LOG = join(STORE_ROOT, "logs", "cli-probe.log");

let probeLogged = false;

async function logProbeOnce(reason: string): Promise<void> {
  if (probeLogged) return;
  probeLogged = true;
  try {
    await mkdir(dirname(PROBE_LOG), { recursive: true });
    await appendFile(
      PROBE_LOG,
      `${new Date().toISOString()} codex-cli probe: ${reason}\n`,
      "utf8"
    );
  } catch {
    // ignore
  }
}

function renderPromptFromMessages(messages: ChatMessage[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    if (m.role === "system") parts.push(`[SYSTEM]\n${m.content}`);
    else if (m.role === "user") parts.push(`[USER]\n${m.content}`);
    else parts.push(`[ASSISTANT]\n${m.content}`);
  }
  return parts.join("\n\n");
}

export async function codexCliChat(
  config: LLMConfig,
  opts: ChatOptions
): Promise<CompletionResult> {
  const prompt = renderPromptFromMessages(opts.messages);

  // Always stdin — same reasoning as claude-cli (Windows cmd.exe mangles
  // argv with newlines/quotes).
  void STDIN_THRESHOLD;
  const args: string[] = ["exec"];

  const start = Date.now();
  return new Promise<CompletionResult>((resolve, reject) => {
    const child = spawn("codex", args, { shell: IS_WIN_CONST });
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
      reject(new Error(`codex-cli timeout after ${config.timeout}ms`));
    }, config.timeout);

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
      if (code === "ENOENT") {
        void logProbeOnce("codex binary not found on PATH");
      }
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        void logProbeOnce(`exit ${code}: ${stderr.slice(0, 200)}`);
        return reject(new Error(classifyCliError(stderr, code, "codex")));
      }
      resolve({
        content: stdout.trim(),
        tokensIn: 0,
        tokensOut: 0,
        model: opts.model ?? config.model,
        latencyMs: Date.now() - start,
      });
    });

    child.stdin?.write(prompt);
    child.stdin?.end();
  });
}

export async function codexCliIsAvailable(config: LLMConfig): Promise<{
  reachable: boolean;
  modelPresent: boolean;
  models: string[];
  reason?: string;
}> {
  const probe = await probeCli("codex");
  if (!probe.installed) {
    return {
      reachable: false,
      modelPresent: false,
      models: [],
      reason: probe.reason ?? "codex CLI not installed",
    };
  }
  return {
    reachable: true,
    modelPresent: true,
    models: [config.model],
  };
}
