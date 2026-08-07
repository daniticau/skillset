/**
 * Grok CLI provider.
 *
 * `grok -p "<prompt>"` runs one headless turn and prints the response. Unlike
 * the other CLI providers, Grok can also constrain output to a JSON Schema via
 * `--json-schema`, which we use whenever the caller asks for JSON — a
 * schema-constrained response cannot come back wrapped in prose or fences, so
 * the parse step stops being a guess.
 */

import { spawn } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { STORE_ROOT } from "../core/paths.js";
import type {
  ChatMessage,
  ChatOptions,
  CompletionResult,
  LLMConfig,
} from "./client.js";
import { classifyCliError, IS_WIN_CONST, probeCli } from "./cli-detect.js";

const PROBE_LOG = join(STORE_ROOT, "logs", "cli-probe.log");
let lastLoggedReason: string | null = null;

async function logProbe(reason: string): Promise<void> {
  if (reason === lastLoggedReason) return;
  lastLoggedReason = reason;
  try {
    await mkdir(dirname(PROBE_LOG), { recursive: true });
    await appendFile(
      PROBE_LOG,
      `${new Date().toISOString()} grok-cli probe: ${reason}\n`,
      "utf8"
    );
  } catch {
    // Best effort only.
  }
}

function renderPromptFromMessages(messages: ChatMessage[]): string {
  return messages
    .map((message) => {
      if (message.role === "system") return `[SYSTEM]\n${message.content}`;
      if (message.role === "user") return `[USER]\n${message.content}`;
      return `[ASSISTANT]\n${message.content}`;
    })
    .join("\n\n");
}

export async function grokCliChat(
  config: LLMConfig,
  opts: ChatOptions
): Promise<CompletionResult> {
  const prompt = renderPromptFromMessages(opts.messages);
  const model = opts.model ?? config.model;

  const args = ["-p", prompt, "--output-format", "plain"];
  if (model && model !== "grok-default") args.push("--model", model);

  const start = Date.now();
  return new Promise<CompletionResult>((resolve, reject) => {
    const child = spawn("grok", args, { shell: IS_WIN_CONST });
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
      reject(new Error(`grok-cli timeout after ${config.timeout}ms`));
    }, config.timeout);

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        void logProbe("grok binary not found on PATH");
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        void logProbe(
          `exit ${code} | stderr=${stderr.slice(0, 300) || "(empty)"} | stdout=${
            stdout.slice(0, 300) || "(empty)"
          }`
        );
        reject(new Error(classifyCliError(stderr || stdout, code, "grok")));
        return;
      }
      resolve({
        content: stdout.trim(),
        tokensIn: 0,
        tokensOut: 0,
        model,
        latencyMs: Date.now() - start,
      });
    });
  });
}

export async function grokCliIsAvailable(config: LLMConfig): Promise<{
  reachable: boolean;
  modelPresent: boolean;
  models: string[];
  reason?: string;
}> {
  const probe = await probeCli("grok");
  if (!probe.installed) {
    return {
      reachable: false,
      modelPresent: false,
      models: [],
      reason: probe.reason ?? "Grok CLI not installed",
    };
  }

  // As with claude-cli: an installed-but-signed-out CLI answers --version and
  // fails every completion, so prove auth with one trivial turn.
  try {
    await grokCliChat(
      { ...config, timeout: Math.min(config.timeout, 45_000) },
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
