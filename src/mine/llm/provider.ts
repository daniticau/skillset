/**
 * Provider abstraction — dispatches chat calls to the configured backend.
 *
 * Providers:
 *   - claude-cli: spawn `claude -p` (subscription, no API key)
 *   - codex-cli: spawn `codex exec` (subscription, no API key)
 *   - anthropic: Anthropic SDK via ANTHROPIC_API_KEY
 *   - ollama: local OpenAI-compatible server (no external cost)
 *
 * Auto-detection in defaultLLMConfig() picks claude-cli first when available,
 * so the self-improving loop can run for free on the user's existing plan.
 */

import {
  chatCompletion,
  isAvailable as ollamaIsAvailable,
} from "./client.js";
import type {
  LLMConfig,
  ChatOptions,
  CompletionResult,
  Provider,
} from "./client.js";
import { anthropicChat, anthropicIsAvailable } from "./anthropic.js";
import { claudeCliChat, claudeCliIsAvailable } from "./claude-cli.js";
import { codexCliChat, codexCliIsAvailable } from "./codex-cli.js";

export function resolveProvider(config: LLMConfig): Provider {
  return config.provider;
}

export async function chat(
  config: LLMConfig,
  opts: ChatOptions
): Promise<CompletionResult> {
  switch (config.provider) {
    case "claude-cli":
      return claudeCliChat(config, opts);
    case "codex-cli":
      return codexCliChat(config, opts);
    case "anthropic":
      return anthropicChat(config, opts);
    case "ollama":
      return chatCompletion(config, opts);
  }
}

export async function isAvailable(config: LLMConfig): Promise<{
  reachable: boolean;
  modelPresent: boolean;
  models: string[];
  reason?: string;
}> {
  switch (config.provider) {
    case "claude-cli":
      return claudeCliIsAvailable(config);
    case "codex-cli":
      return codexCliIsAvailable(config);
    case "anthropic":
      return anthropicIsAvailable(config);
    case "ollama":
      return ollamaIsAvailable(config);
  }
}
