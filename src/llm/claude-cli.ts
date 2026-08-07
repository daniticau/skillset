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
import { STORE_ROOT } from "../core/paths.js";
import { join } from "node:path";
import { classifyCliError, probeCli, IS_WIN_CONST } from "./cli-detect.js";

const PROBE_LOG = join(STORE_ROOT, "logs", "cli-probe.log");

/**
 * True after we've logged at least one probe event in this process. We still
 * log subsequent errors but dedupe consecutive identical reasons to keep the
 * file bounded.
 */
let lastLoggedReason: string | null = null;

async function logProbe(reason: string): Promise<void> {
  if (reason === lastLoggedReason) return;
  lastLoggedReason = reason;
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
  const model = opts.model ?? config.model;

  // Always deliver the prompt via stdin. On Windows, shell:true routes through
  // cmd.exe which mangles argv containing newlines, quotes, or shell metachars
  // — and our prompts have all three. Stdin sidesteps all escaping concerns.
  const args: string[] = ["-p"];
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
        void logProbe("claude binary not found on PATH");
      }
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        // Log BOTH stderr and stdout so we can diagnose silent exits where the
        // CLI writes its complaint to stdout or just exits with no output.
        const diag = [
          `exit ${code}`,
          `args=${JSON.stringify(args)}`,
          `stderr=${stderr.slice(0, 400) || "(empty)"}`,
          `stdout=${stdout.slice(0, 400) || "(empty)"}`,
          `prompt_head=${prompt.slice(0, 120).replace(/\n/g, "\\n")}`,
        ].join(" | ");
        void logProbe(diag);
        return reject(new Error(classifyCliError(stderr, code, "claude")));
      }
      resolve({
        content: stdout.trim(),
        tokensIn: 0,
        tokensOut: 0,
        model,
        latencyMs: Date.now() - start,
      });
    });

    child.stdin?.write(prompt);
    child.stdin?.end();
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
  // `--version` only proves the binary exists. A logged-out CLI answers it
  // happily and then fails every completion, so reporting "reachable" off the
  // version check alone tells the user the pipeline is healthy when nothing can
  // run. Spend one trivial completion to find out for real.
  try {
    await claudeCliChat(
      { ...config, timeout: Math.min(config.timeout, 30_000) },
      { messages: [{ role: "user", content: "Reply with: ok" }], temperature: 0 }
    );
  } catch (err) {
    return {
      reachable: false,
      modelPresent: false,
      models: [],
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  return {
    reachable: true,
    modelPresent: true,
    models: [config.model],
  };
}
