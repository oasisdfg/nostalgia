// Internal DB row shapes (snake_case) and row -> DTO mappers. Repositories are
// the only code that touches SQL; everything else consumes the DTOs from
// @shared/contracts/ipc.
import type {
  SystemDTO,
  EmulatorDTO,
  SystemEmulatorDTO,
  GameDTO,
  GameFileDTO,
  MediaAssetDTO,
  SaveDTO,
  DownloadDTO,
  CacheState,
  HashSource,
  DownloadState,
  SaveType,
  SyncState,
} from '@shared/contracts/ipc';
import type { HashAlgo, MediaType, MetadataProviderId } from '@shared/contracts/metadata';

const bool = (n: number): boolean => n === 1;

export function parseStringArray(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

/** media_assets.local_path is stored relative to the assets root; expose it as an asset:// URL. */
export function toAssetUrl(relPath: string): string {
  const parts = relPath.split(/[\\/]/).filter((p) => p.length > 0).map(encodeURIComponent);
  return `asset://assets/${parts.join('/')}`;
}

// --- Row shapes ---

export interface SystemRow {
  id: number;
  slug: string;
  name: string;
  short_name: string | null;
  manufacturer: string | null;
  sort_order: number;
  enabled: number;
  is_builtin: number;
  default_emulator_id: number | null;
  icon_path: string | null;
  created_at: number;
  updated_at: number;
}

export interface EmulatorRow {
  id: number;
  name: string;
  exe_path: string;
  working_dir: string | null;
  default_args_template: string;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export interface SystemEmulatorRow {
  id: number;
  system_id: number;
  emulator_id: number;
  launch_args_template: string;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export interface GameRow {
  id: number;
  system_id: number;
  igdb_id: number | null;
  title: string;
  sort_title: string;
  region: string | null;
  language: string | null;
  description: string | null;
  release_date: string | null;
  genre: string | null;
  players: number | null;
  rating: number | null;
  favorite: number;
  last_played_at: number | null;
  play_count: number;
  added_at: number;
  archived: number;
  metadata_locked: number;
  launch_reminder_dismissed: number;
  updated_at: number;
}

export interface GameFileRow {
  id: number;
  game_id: number;
  storage_key: string;
  display_name: string | null;
  size_bytes: number | null;
  crc32: string | null;
  md5: string | null;
  sha1: string | null;
  hash_source: HashSource;
  disc_no: number | null;
  is_primary: number;
  cache_state: CacheState;
  source: string;
  /** PS3 SERIAL (PARAM.SFO TITLE_ID) once read from the dump; NULL otherwise. */
  title_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface MediaAssetRow {
  id: number;
  game_id: number;
  type: MediaType;
  local_path: string;
  source_url: string | null;
  provider: MetadataProviderId | null;
  width: number | null;
  height: number | null;
  checksum: string | null;
  downloaded_at: number;
}

export interface SaveRow {
  id: number;
  game_id: number;
  system_id: number;
  type: SaveType;
  slot: number | null;
  local_path: string;
  size_bytes: number | null;
  crc32: string | null;
  md5: string | null;
  sha1: string | null;
  sync_state: SyncState;
  remote_id: string | null;
  updated_at: number;
  last_synced_at: number | null;
}

export interface DownloadRow {
  id: number;
  game_file_id: number;
  state: DownloadState;
  bytes_total: number | null;
  bytes_received: number;
  resume_offset: number;
  checksum_expected: string | null;
  checksum_algo: HashAlgo | null;
  error: string | null;
  priority: number;
  created_at: number;
  updated_at: number;
}

// --- Mappers ---

export const mapSystem = (r: SystemRow): SystemDTO => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  shortName: r.short_name,
  manufacturer: r.manufacturer,
  sortOrder: r.sort_order,
  enabled: bool(r.enabled),
  isBuiltin: bool(r.is_builtin),
  defaultEmulatorId: r.default_emulator_id,
  iconPath: r.icon_path,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const mapEmulator = (r: EmulatorRow): EmulatorDTO => ({
  id: r.id,
  name: r.name,
  exePath: r.exe_path,
  workingDir: r.working_dir,
  defaultArgsTemplate: parseStringArray(r.default_args_template),
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const mapSystemEmulator = (r: SystemEmulatorRow): SystemEmulatorDTO => ({
  id: r.id,
  systemId: r.system_id,
  emulatorId: r.emulator_id,
  launchArgsTemplate: parseStringArray(r.launch_args_template),
  isActive: bool(r.is_active),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// `has_files` (1/0) is an optional joined column: true when the game owns at least one
// game_files row. A file-less row is a "My List" favorite of an un-owned catalog title.
// Queries that don't select it leave hasFiles false (callers that care always select it).
export const mapGame = (r: GameRow & { has_files?: number }): GameDTO => ({
  id: r.id,
  systemId: r.system_id,
  igdbId: r.igdb_id,
  title: r.title,
  sortTitle: r.sort_title,
  region: r.region,
  language: r.language,
  description: r.description,
  releaseDate: r.release_date,
  genre: r.genre,
  players: r.players,
  rating: r.rating,
  favorite: bool(r.favorite),
  hasFiles: r.has_files != null ? bool(r.has_files) : false,
  lastPlayedAt: r.last_played_at,
  playCount: r.play_count,
  addedAt: r.added_at,
  archived: bool(r.archived),
  metadataLocked: bool(r.metadata_locked),
  launchReminderDismissed: bool(r.launch_reminder_dismissed),
});

export const mapGameFile = (r: GameFileRow): GameFileDTO => ({
  id: r.id,
  gameId: r.game_id,
  storageKey: r.storage_key,
  displayName: r.display_name,
  sizeBytes: r.size_bytes,
  crc32: r.crc32,
  md5: r.md5,
  sha1: r.sha1,
  hashSource: r.hash_source,
  discNo: r.disc_no,
  isPrimary: bool(r.is_primary),
  cacheState: r.cache_state,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const mapMediaAsset = (r: MediaAssetRow): MediaAssetDTO => ({
  id: r.id,
  gameId: r.game_id,
  type: r.type,
  localPath: toAssetUrl(r.local_path),
  sourceUrl: r.source_url,
  provider: r.provider,
  width: r.width,
  height: r.height,
  checksum: r.checksum,
  downloadedAt: r.downloaded_at,
});

export const mapSave = (r: SaveRow): SaveDTO => ({
  id: r.id,
  gameId: r.game_id,
  systemId: r.system_id,
  type: r.type,
  slot: r.slot,
  localPath: r.local_path,
  sizeBytes: r.size_bytes,
  crc32: r.crc32,
  md5: r.md5,
  sha1: r.sha1,
  syncState: r.sync_state,
  remoteId: r.remote_id,
  updatedAt: r.updated_at,
  lastSyncedAt: r.last_synced_at,
});

export const mapDownload = (r: DownloadRow): DownloadDTO => ({
  id: r.id,
  gameFileId: r.game_file_id,
  state: r.state,
  bytesTotal: r.bytes_total,
  bytesReceived: r.bytes_received,
  resumeOffset: r.resume_offset,
  checksumExpected: r.checksum_expected,
  checksumAlgo: r.checksum_algo,
  error: r.error,
  priority: r.priority,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
