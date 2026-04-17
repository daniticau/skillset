/**
 * Provider abstraction — dispatches chat calls to the configured backend.
 * Defaults to Anthropic (Haiku 4.5); Ollama remains an option for users with
 * SKILLSET_LLM_PROVIDER=ollama (retained for local-only workflows).
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

export function resolveProvider(config: LLMConfig): Provider {
  return config.provider;
}

export async function chat(
  config: LLMConfig,
  opts: ChatOptions
): Promise<CompletionResult> {
  if (resolveProvider(config) === "anthropic") {
    return anthropicChat(config, opts);
  }
  return chatCompletion(config, opts);
}

export async function isAvailable(config: LLMConfig): Promise<{
  reachable: boolean;
  modelPresent: boolean;
  models: string[];
  reason?: string;
}> {
  if (resolveProvider(config) === "anthropic") {
    return anthropicIsAvailable(config);
  }
  return ollamaIsAvailable(config);
}
