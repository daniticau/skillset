/** Kimi Code CLI provider for optional Skillset synthesis and triage. */

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
let probeLogged = false;

async function logProbeOnce(reason: string): Promise<void> {
  if (probeLogged) return;
  probeLogged = true;
  try {
    await mkdir(dirname(PROBE_LOG), { recursive: true });
    await appendFile(
      PROBE_LOG,
      `${new Date().toISOString()} kimi-cli probe: ${reason}\n`,
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

export async function kimiCliChat(
  config: LLMConfig,
  opts: ChatOptions
): Promise<CompletionResult> {
  const prompt = renderPromptFromMessages(opts.messages);
  const model = opts.model ?? config.model;
  const args = ["-p", prompt, "--output-format", "text"];
  if (model && model !== "kimi-default") args.push("--model", model);

  const start = Date.now();
  return new Promise<CompletionResult>((resolve, reject) => {
    const child = spawn("kimi", args, { shell: IS_WIN_CONST });
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
      reject(new Error(`kimi-cli timeout after ${config.timeout}ms`));
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
        void logProbeOnce("kimi binary not found on PATH");
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        void logProbeOnce(`exit ${code}: ${(stderr || stdout).slice(0, 200)}`);
        reject(new Error(classifyCliError(stderr || stdout, code, "kimi")));
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

export async function kimiCliIsAvailable(config: LLMConfig): Promise<{
  reachable: boolean;
  modelPresent: boolean;
  models: string[];
  reason?: string;
}> {
  const probe = await probeCli("kimi");
  if (!probe.installed) {
    return {
      reachable: false,
      modelPresent: false,
      models: [],
      reason: probe.reason ?? "Kimi Code CLI not installed",
    };
  }
  return {
    reachable: true,
    modelPresent: true,
    models: [config.model],
  };
}
