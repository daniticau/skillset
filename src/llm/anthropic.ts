/**
 * Anthropic API client — Haiku 4.5 chat with prompt caching.
 *
 * System prompt is sent with cache_control so repeated calls (e.g. per-cluster
 * triage across a `sks make` run) hit the 5-minute prompt cache and amortize
 * input-token cost.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMConfig,
  ChatOptions,
  CompletionResult,
  ChatMessage,
} from "./client.js";

let cached: { apiKey: string; baseURL: string | undefined; client: Anthropic } | null = null;

function getClient(apiKey: string, baseURL: string | undefined): Anthropic {
  if (cached && cached.apiKey === apiKey && cached.baseURL === baseURL) {
    return cached.client;
  }
  const client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
  cached = { apiKey, baseURL, client };
  return client;
}

function splitSystem(messages: ChatMessage[]): {
  system: string;
  conversation: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const systems: string[] = [];
  const conversation: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of messages) {
    if (m.role === "system") {
      systems.push(m.content);
    } else {
      conversation.push({ role: m.role, content: m.content });
    }
  }
  return { system: systems.join("\n\n"), conversation };
}

function resolveApiKey(config: LLMConfig): string {
  const key = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY not set — export it or add it to ~/.skillset/.env"
    );
  }
  return key;
}

function anthropicBaseURL(config: LLMConfig): string | undefined {
  // SDK defaults to https://api.anthropic.com; pass through only if the user
  // configured a non-default URL (e.g. a proxy).
  const url = config.baseUrl;
  if (!url) return undefined;
  if (url === "https://api.anthropic.com") return undefined;
  return url;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function anthropicChat(
  config: LLMConfig,
  opts: ChatOptions
): Promise<CompletionResult> {
  const client = getClient(resolveApiKey(config), anthropicBaseURL(config));
  const model = opts.model ?? config.model;
  const { system, conversation } = splitSystem(opts.messages);

  let lastError: unknown;
  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    const start = Date.now();
    try {
      const resp = await client.messages.create(
        {
          model,
          max_tokens: opts.maxTokens ?? 2048,
          temperature: opts.temperature ?? 0.3,
          ...(system
            ? {
                system: [
                  {
                    type: "text",
                    text: system,
                    cache_control: { type: "ephemeral" },
                  },
                ],
              }
            : {}),
          messages: conversation,
        },
        { timeout: config.timeout }
      );
      const content = resp.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("");
      return {
        content,
        tokensIn: resp.usage?.input_tokens ?? 0,
        tokensOut: resp.usage?.output_tokens ?? 0,
        model: resp.model,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number })?.status;
      // Fail fast on auth/validation errors (4xx except 429)
      if (status !== undefined && status >= 400 && status < 500 && status !== 429) {
        break;
      }
      await sleep(500 * Math.pow(2, attempt));
    }
  }

  throw new Error(
    `Anthropic chat failed after ${config.maxRetries} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

export async function anthropicIsAvailable(config: LLMConfig): Promise<{
  reachable: boolean;
  modelPresent: boolean;
  models: string[];
  reason?: string;
}> {
  const key = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return {
      reachable: false,
      modelPresent: false,
      models: [],
      reason: "ANTHROPIC_API_KEY not set",
    };
  }
  // Cheap check — don't round-trip the API. Model availability is implicit.
  return { reachable: true, modelPresent: true, models: [config.model] };
}
