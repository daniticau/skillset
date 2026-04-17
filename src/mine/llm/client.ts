/**
 * Ollama client (OpenAI-compatible API).
 *
 * Targets the local Ollama server on the user's DGX Spark.
 * Default endpoint: http://localhost:11434/v1
 * Used for embeddings and as an optional fallback chat provider.
 */

import { whichSync } from "./cli-detect.js";

export type Provider = "claude-cli" | "codex-cli" | "anthropic" | "ollama";

export interface LLMConfig {
  provider: Provider;
  baseUrl: string;
  model: string;
  apiKey?: string;
  embeddingModel?: string;
  timeout: number;
  maxRetries: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  /** Optional override for which model to use (falls back to config.model). */
  model?: string;
}

export interface CompletionResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
  latencyMs: number;
}

export interface EmbeddingResult {
  vector: number[];
  model: string;
}

/**
 * Pick a sensible default provider based on what's on PATH + env. Runs sync so
 * defaultLLMConfig() doesn't await. Preference order:
 *   1. SKILLSET_LLM_PROVIDER env var (explicit opt-in, always honored)
 *   2. claude-cli if `claude` is on PATH (uses subscription, no API key)
 *   3. anthropic if ANTHROPIC_API_KEY is set
 *   4. codex-cli if `codex` is on PATH
 *   5. ollama (last resort — works offline on the user's DGX Spark)
 */
function detectDefaultProvider(): Provider {
  const raw = process.env.SKILLSET_LLM_PROVIDER?.toLowerCase();
  if (raw === "claude-cli" || raw === "codex-cli" || raw === "anthropic" || raw === "ollama") {
    return raw;
  }
  if (whichSync("claude")) return "claude-cli";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (whichSync("codex")) return "codex-cli";
  return "ollama";
}

function defaultModelFor(provider: Provider): string {
  switch (provider) {
    case "claude-cli":
      // Default to the CLI's own configured model unless overridden. The CLI
      // picks a sensible default (Sonnet in Claude Code); we pass through.
      return "claude-sonnet-4-6";
    case "codex-cli":
      return "codex-default";
    case "anthropic":
      return "claude-haiku-4-5-20251001";
    case "ollama":
    default:
      return "qwen3-coder";
  }
}

function defaultBaseUrlFor(provider: Provider): string {
  switch (provider) {
    case "ollama":
      return "http://localhost:11434/v1";
    case "anthropic":
      return "https://api.anthropic.com";
    case "claude-cli":
    case "codex-cli":
    default:
      return ""; // subprocess providers don't use HTTP
  }
}

export function defaultLLMConfig(overrides: Partial<LLMConfig> = {}): LLMConfig {
  const provider = detectDefaultProvider();
  const envModel = process.env.SKILLSET_LLM_MODEL;
  // SKILLSET_LLM_MODEL only honored when it plausibly fits the provider. For
  // CLI providers we pass through to their own defaults unless user overrides.
  const envModelFits =
    envModel !== undefined &&
    (provider === "ollama"
      ? !envModel.startsWith("claude-")
      : provider === "anthropic"
        ? envModel.startsWith("claude-")
        : true);

  return {
    provider,
    baseUrl: process.env.SKILLSET_LLM_URL ?? defaultBaseUrlFor(provider),
    model: envModelFits && envModel ? envModel : defaultModelFor(provider),
    apiKey: process.env.ANTHROPIC_API_KEY,
    embeddingModel: process.env.SKILLSET_EMBED_MODEL,
    timeout: 120_000,
    maxRetries: 3,
    ...overrides,
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Low-level fetch with timeout. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check if the Ollama server is reachable and the configured model is available.
 * Uses Ollama's native /api/tags endpoint (not OpenAI-compatible).
 */
export async function isAvailable(config: LLMConfig): Promise<{
  reachable: boolean;
  modelPresent: boolean;
  models: string[];
  reason?: string;
}> {
  // Derive the Ollama root (strip /v1 suffix if present).
  const root = config.baseUrl.replace(/\/v1\/?$/, "");
  const tagsUrl = `${root}/api/tags`;

  try {
    const resp = await fetchWithTimeout(tagsUrl, { method: "GET" }, 5000);
    if (!resp.ok) {
      return { reachable: false, modelPresent: false, models: [], reason: `HTTP ${resp.status}` };
    }
    const data = (await resp.json()) as { models?: Array<{ name?: string; model?: string }> };
    const models = (data.models ?? [])
      .map((m) => m.name ?? m.model ?? "")
      .filter((n): n is string => n.length > 0);
    // Match by prefix (e.g., "qwen3-coder" matches "qwen3-coder:latest")
    const modelPresent = models.some(
      (m) => m === config.model || m.startsWith(`${config.model}:`)
    );
    return { reachable: true, modelPresent, models };
  } catch (err) {
    return {
      reachable: false,
      modelPresent: false,
      models: [],
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Probe Ollama for an available embedding model. Returns the first recognized
 * one in preference order, or undefined if none found.
 *
 * Honors SKILLSET_EMBED_MODEL env var as an override.
 */
export async function detectEmbeddingModel(
  config: LLMConfig
): Promise<string | undefined> {
  // Explicit override wins
  if (config.embeddingModel) return config.embeddingModel;

  const root = config.baseUrl.replace(/\/v1\/?$/, "");
  const tagsUrl = `${root}/api/tags`;

  let models: string[] = [];
  try {
    const resp = await fetchWithTimeout(tagsUrl, { method: "GET" }, 5000);
    if (!resp.ok) return undefined;
    const data = (await resp.json()) as {
      models?: Array<{ name?: string; model?: string }>;
    };
    models = (data.models ?? [])
      .map((m) => m.name ?? m.model ?? "")
      .filter((n): n is string => n.length > 0);
  } catch {
    return undefined;
  }

  // Preference order: small-and-good first, then larger/general
  const preferences = [
    "nomic-embed-text",
    "mxbai-embed-large",
    "bge-large",
    "bge-base",
    "bge-small",
    "all-minilm",
  ];
  for (const pref of preferences) {
    const match = models.find((m) => m === pref || m.startsWith(`${pref}:`));
    if (match) return match;
  }

  // Last resort: any model whose name hints at embeddings
  const embedHint = models.find((m) => /embed/i.test(m));
  return embedHint;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  model?: string;
}

/** OpenAI-compatible chat completion via Ollama's /v1/chat/completions endpoint. */
export async function chatCompletion(
  config: LLMConfig,
  opts: ChatOptions
): Promise<CompletionResult> {
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const model = opts.model ?? config.model;

  const body: Record<string, unknown> = {
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.3,
    stream: false,
  };
  if (opts.maxTokens != null) body["max_tokens"] = opts.maxTokens;
  if (opts.jsonMode) body["response_format"] = { type: "json_object" };

  let lastError: unknown;
  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    const start = Date.now();
    try {
      const resp = await fetchWithTimeout(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        config.timeout
      );

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`LLM HTTP ${resp.status}: ${text.slice(0, 200)}`);
      }

      const data = (await resp.json()) as ChatCompletionResponse;
      const content = data.choices?.[0]?.message?.content ?? "";
      return {
        content,
        tokensIn: data.usage?.prompt_tokens ?? 0,
        tokensOut: data.usage?.completion_tokens ?? 0,
        model: data.model ?? model,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      lastError = err;
      // Don't retry on client abort (timeout)
      if (err instanceof Error && err.name === "AbortError") {
        break;
      }
      const backoffMs = 500 * Math.pow(2, attempt);
      await sleep(backoffMs);
    }
  }

  throw new Error(
    `LLM chat completion failed after ${config.maxRetries} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

interface EmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
  model?: string;
}

/** OpenAI-compatible embeddings (requires an embedding model pulled in Ollama). */
export async function embed(
  config: LLMConfig,
  texts: string[]
): Promise<EmbeddingResult[]> {
  if (!config.embeddingModel) {
    throw new Error("No embeddingModel configured");
  }
  const url = `${config.baseUrl.replace(/\/$/, "")}/embeddings`;

  const resp = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: config.embeddingModel, input: texts }),
    },
    config.timeout
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Embedding HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }

  const data = (await resp.json()) as EmbeddingResponse;
  const results = data.data ?? [];
  return results.map((r) => ({
    vector: r.embedding ?? [],
    model: data.model ?? config.embeddingModel!,
  }));
}

/**
 * Parse a JSON response from the LLM, tolerating common wrapper patterns
 * (code fences, prose prefix/suffix).
 */
export function parseLLMJson<T>(content: string): T | null {
  if (!content) return null;

  // Strip code fences
  let clean = content.trim();
  if (clean.startsWith("```")) {
    clean = clean.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
  }

  // Try direct parse
  try {
    return JSON.parse(clean) as T;
  } catch {
    // Fall through to bracket-matching
  }

  // Extract first {...} or [...] block
  const firstBrace = Math.min(
    ...[clean.indexOf("{"), clean.indexOf("[")].filter((i) => i >= 0)
  );
  if (firstBrace === Infinity) return null;

  const lastBrace = Math.max(clean.lastIndexOf("}"), clean.lastIndexOf("]"));
  if (lastBrace <= firstBrace) return null;

  try {
    return JSON.parse(clean.slice(firstBrace, lastBrace + 1)) as T;
  } catch {
    return null;
  }
}
