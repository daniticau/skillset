export {
  defaultLLMConfig,
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
  Provider,
} from "./client.js";
export { chat, isAvailable, resolveProvider } from "./provider.js";
export {
  extractionSystemPrompt,
  extractionUserPrompt,
  synthesisSystemPrompt,
  synthesisUserPrompt,
  validationPrompt,
  triageSystemPrompt,
  triageUserPrompt,
  editRewriteSystemPrompt,
  editRewriteUserPrompt,
} from "./prompts.js";
export type { ConversationWindow } from "./prompts.js";
