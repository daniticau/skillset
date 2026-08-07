export {
  defaultLLMConfig,
  chatCompletion,
  embed,
  parseLLMJson,
  detectEmbeddingModel,
  ollamaEmbeddingConfig,
} from "./client.js";
export type {
  LLMConfig,
  ChatMessage,
  ChatOptions,
  CompletionResult,
  EmbeddingResult,
  Provider,
} from "./client.js";
export { chat, isAvailable, resolveProvider } from "./provider.js";
export { whichSync, probeCli, classifyCliError } from "./cli-detect.js";
export type { ProbeResult } from "./cli-detect.js";
