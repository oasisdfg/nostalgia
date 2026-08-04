// Provider-agnostic save-sync contract. Mirrors the StorageProvider pattern but is
// its own abstraction: a SaveSyncProvider moves a game's saves to/from a backend.
// The ship-now implementation is local-folder; a cloud backend can drop in later.
// Imported by both main and renderer - TYPES ONLY, no Node/Electron imports.

import type { DownloadOptions, DownloadResult, HashRef } from './storage';

export interface GameRef {
  gameId: number;
  systemSlug: string;
  /** opaque key of the primary file; used to namespace remote saves */
  primaryStorageKey: string;
  hashes?: HashRef[];
}

export interface RemoteSave {
  remoteId: string;
  /** opaque remote key/name */
  key: string;
  sizeBytes: number | null;
  /** epoch ms */
  updatedAt: number;
  hashes?: HashRef[];
}

export interface SaveUploadMeta {
  gameRef: GameRef;
  /** matches saves.type: savestate | memorycard | sram | other */
  type: string;
  slot: number | null;
  /** epoch ms of the local file */
  updatedAt: number;
  hashes?: HashRef[];
}

export interface RemoteSaveRef {
  remoteId: string;
  /** epoch ms reported by the backend after upload */
  updatedAt: number;
}

export interface SaveSyncCapabilities {
  providerId: string;
  supportsDelete: boolean;
}

/**
 * Moves a game's saves to/from a backend. Local-folder now; a future cloud backend
 * satisfies the same interface (resolved via getSaveSyncProvider() in main).
 */
export interface SaveSyncProvider {
  getCapabilities(): SaveSyncCapabilities;
  listSaves(gameRef: GameRef): Promise<RemoteSave[]>;
  uploadSave(localPath: string, meta: SaveUploadMeta): Promise<RemoteSaveRef>;
  downloadSave(
    remoteRef: RemoteSave,
    destPath: string,
    opts?: Omit<DownloadOptions, 'destPath'>,
  ): Promise<DownloadResult>;
  deleteSave?(remoteRef: RemoteSave): Promise<void>;
}
