export {
  defaultLLMConfig,
  isAvailable,
  chatCompletion,
  embed,
  parseLLMJson,
  detectEmbeddingModel,
} from "./client.js";
export type {
  LLMConfig,
  ChatMessage,
  ChatOptions,
  CompletionResult,
  EmbeddingResult,
} from "./client.js";
export {
  extractionSystemPrompt,
  extractionUserPrompt,
  synthesisSystemPrompt,
  synthesisUserPrompt,
  validationPrompt,
} from "./prompts.js";
export type { ConversationWindow } from "./prompts.js";
