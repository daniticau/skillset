/**
 * Claude Code CLI provider — shells out to `claude -p <prompt>` to run a single
 * completion under the user's existing Claude Code subscription. No API key.
 *
 * Contract assumptions (verified at runtime by a probe logged to
 * ~/.skillset/logs/cli-probe.log):
 *   - `claude -p "prompt"` runs one turn in non-interactive "print mode" and
 *     writes the assistant response to stdout, exit 0.
 *   - Large prompts (> 2KB) exceed the Windows cmdline limit, so we pass the
 *     prompt on stdin with `-p -` when supported; otherwise argv.
 *   - `--model <name>` selects a model; we pass config.model through.
 *
 * Concurrency: capped at 1 — subscription throughput is the bottleneck, and
 * spawning many claude processes risks rate limits.
 */

import { spawn } from "node:child_process";
import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  LLMConfig,
  ChatOptions,
  CompletionResult,
  ChatMessage,
} from "./client.js";
import { STORE_ROOT } from "../../core/paths.js";
import { join } from "node:path";
import { classifyCliError, probeCli, IS_WIN_CONST } from "./cli-detect.js";

const STDIN_THRESHOLD = 2048; // bytes above which we switch to stdin
const PROBE_LOG = join(STORE_ROOT, "logs", "cli-probe.log");

/** True when the binary has been probed (once per process). */
let probeLogged = false;

async function logProbeOnce(reason: string): Promise<void> {
  if (probeLogged) return;
  probeLogged = true;
  try {
    await mkdir(dirname(PROBE_LOG), { recursive: true });
    await appendFile(
      PROBE_LOG,
      `${new Date().toISOString()} claude-cli probe: ${reason}\n`,
      "utf8"
    );
  } catch {
    // Best-effort logging; never fail the caller.
  }
}

/**
 * Flatten ChatMessage[] into a single prompt string for `claude -p`.
 * System messages are marked explicitly; multi-turn conversations are joined
 * with blank lines. Claude Code print-mode is single-turn so the prompt is
 * the full concatenated context.
 */
function renderPromptFromMessages(messages: ChatMessage[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    if (m.role === "system") parts.push(`[SYSTEM]\n${m.content}`);
    else if (m.role === "user") parts.push(`[USER]\n${m.content}`);
    else parts.push(`[ASSISTANT]\n${m.content}`);
  }
  return parts.join("\n\n");
}

export async function claudeCliChat(
  config: LLMConfig,
  opts: ChatOptions
): Promise<CompletionResult> {
  const prompt = renderPromptFromMessages(opts.messages);
  const useStdin = Buffer.byteLength(prompt, "utf8") > STDIN_THRESHOLD;
  const model = opts.model ?? config.model;

  const args: string[] = [];
  if (useStdin) {
    args.push("-p");
  } else {
    args.push("-p", prompt);
  }
  if (model) args.push("--model", model);

  const start = Date.now();
  return new Promise<CompletionResult>((resolve, reject) => {
    const child = spawn("claude", args, { shell: IS_WIN_CONST });
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
      reject(new Error(`claude-cli timeout after ${config.timeout}ms`));
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
        void logProbeOnce("claude binary not found on PATH");
      }
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        void logProbeOnce(`exit ${code}: ${stderr.slice(0, 200)}`);
        return reject(new Error(classifyCliError(stderr, code, "claude")));
      }
      resolve({
        content: stdout.trim(),
        tokensIn: 0, // CLI doesn't expose token counts
        tokensOut: 0,
        model,
        latencyMs: Date.now() - start,
      });
    });

    if (useStdin) {
      child.stdin?.write(prompt);
      child.stdin?.end();
    }
  });
}

export async function claudeCliIsAvailable(config: LLMConfig): Promise<{
  reachable: boolean;
  modelPresent: boolean;
  models: string[];
  reason?: string;
}> {
  const probe = await probeCli("claude");
  if (!probe.installed) {
    return {
      reachable: false,
      modelPresent: false,
      models: [],
      reason: probe.reason ?? "claude CLI not installed",
    };
  }
  // We trust that claude is logged in if it responds to --version. Auth errors
  // surface at first chat call (classifyCliError catches them).
  return {
    reachable: true,
    modelPresent: true,
    models: [config.model],
  };
}
