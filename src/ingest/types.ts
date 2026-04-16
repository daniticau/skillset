// Shapes forked from nia-cli (src/services/local/types.ts, MIT). Only the
// pieces relevant to local file/folder ingestion — the Nia cloud sync types
// (LocalSource, LocalSyncUploadPayload, etc.) are deliberately omitted.

export interface FolderCursor {
  [key: string]: unknown;
  last_mtime?: number;
  last_path?: string;
  cursor_version?: number;
  root_path?: string;
}

export interface LocalFileItem {
  path: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface SyncExtractionResult {
  files: LocalFileItem[];
  cursor: Record<string, unknown>;
  stats: Record<string, unknown>;
}
