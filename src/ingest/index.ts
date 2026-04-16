export {
  discoverClaudeCodeHistory,
  discoverSessionSources,
  type SessionSource,
} from "./discovery.js";

export {
  extractFolderIncremental,
  normalizeFolderCursor,
  FOLDER_CURSOR_VERSION,
  MAX_ROWS,
  MAX_FILE_SIZE_BYTES,
  TYPE_FOLDER,
} from "./folder.js";

export type { FolderCursor, LocalFileItem, SyncExtractionResult } from "./types.js";
