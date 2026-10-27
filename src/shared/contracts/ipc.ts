// The closed IPC contract between main and renderer - the single source of truth.
// Channels follow the `domain:action` convention. Invoke channels are
// request/response (ipcMain.handle); event channels are main->renderer push.
// Types only, plus the runtime channel-name arrays the preload validates against.

import type { HashAlgo } from './storage';
import type {
  MediaType,
  MetadataProviderId,
  MetadataMatch,
  RateLimitState,
} from './metadata';
import type { CatalogListResult, CatalogGameDetail, CatalogConnectionResult, CatalogSort } from './catalog';
import type { RecompDTO, RecompInstallState } from './recomps';

// ---------------------------------------------------------------------------
// Domain enums (mirror the SQLite CHECK constraints)
// ---------------------------------------------------------------------------

export type CacheState = 'remote' | 'downloading' | 'cached' | 'stale' | 'error';
export type HashSource = 'manifest' | 'post_download' | 'none';
export type DownloadState =
  | 'queued'
  | 'downloading'
  | 'paused'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'canceled';
export type SaveType = 'savestate' | 'memorycard' | 'sram' | 'other';
export type SyncState =
  | 'local_only'
  | 'synced'
  | 'pending_upload'
  | 'pending_download'
  | 'conflict';
export type ScrapeState =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'no_match';

// ---------------------------------------------------------------------------
// DTOs (camelCase; repositories map snake_case rows -> these)
// ---------------------------------------------------------------------------

export interface SystemDTO {
  id: number;
  slug: string;
  name: string;
  shortName: string | null;
  manufacturer: string | null;
  sortOrder: number;
  enabled: boolean;
  isBuiltin: boolean;
  defaultEmulatorId: number | null;
  iconPath: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface EmulatorDTO {
  id: number;
  name: string;
  /** opaque, verbatim absolute path (set only via the file dialog) */
  exePath: string;
  workingDir: string | null;
  defaultArgsTemplate: string[];
  notes: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SystemEmulatorDTO {
  id: number;
  systemId: number;
  emulatorId: number;
  launchArgsTemplate: string[];
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface GameDTO {
  id: number;
  systemId: number;
  /** IGDB catalog id this game came from, when known - links a favorite/owned row to
   *  the catalog. NULL for locally-ingested games. */
  igdbId: number | null;
  title: string;
  sortTitle: string;
  region: string | null;
  language: string | null;
  description: string | null;
  releaseDate: string | null;
  genre: string | null;
  players: number | null;
  rating: number | null;
  favorite: boolean;
  /** True when the game owns at least one file. False = a "My List" favorite of an
   *  un-owned catalog title (routes to the catalog detail page, shows a download glyph). */
  hasFiles: boolean;
  lastPlayedAt: number | null;
  playCount: number;
  addedAt: number;
  archived: boolean;
  metadataLocked: boolean;
  /** True when the user chose "don't remind me" for this game's pre-launch setup check. */
  launchReminderDismissed: boolean;
  /** asset:// URL of the game's box art, when known (populated by list queries). */
  coverUrl?: string | null;
}

export interface GameFileDTO {
  id: number;
  gameId: number;
  /** opaque storage key, verbatim */
  storageKey: string;
  displayName: string | null;
  sizeBytes: number | null;
  crc32: string | null;
  md5: string | null;
  sha1: string | null;
  hashSource: HashSource;
  discNo: number | null;
  isPrimary: boolean;
  cacheState: CacheState;
  createdAt: number;
  updatedAt: number;
}

export interface MediaAssetDTO {
  id: number;
  gameId: number;
  type: MediaType;
  /** an asset:// URL for the renderer (never a raw filesystem path) */
  localPath: string;
  sourceUrl: string | null;
  provider: MetadataProviderId | null;
  width: number | null;
  height: number | null;
  checksum: string | null;
  downloadedAt: number;
}

export interface SaveDTO {
  id: number;
  gameId: number;
  systemId: number;
  type: SaveType;
  slot: number | null;
  /** opaque, verbatim */
  localPath: string;
  sizeBytes: number | null;
  crc32: string | null;
  md5: string | null;
  sha1: string | null;
  syncState: SyncState;
  remoteId: string | null;
  updatedAt: number;
  lastSyncedAt: number | null;
}

export interface DownloadDTO {
  id: number;
  gameFileId: number;
  state: DownloadState;
  bytesTotal: number | null;
  bytesReceived: number;
  resumeOffset: number;
  checksumExpected: string | null;
  checksumAlgo: HashAlgo | null;
  error: string | null;
  priority: number;
  createdAt: number;
  updatedAt: number;
}

/** A download joined with its game/system context, for the Downloads manager view. */
export interface DownloadItemDTO {
  id: number;
  gameFileId: number;
  gameId: number;
  title: string;
  systemId: number;
  systemSlug: string;
  systemName: string;
  state: DownloadState;
  bytesTotal: number | null;
  bytesReceived: number;
  /** game_files.size_bytes - a determinate total before the first progress tick */
  sizeBytes: number | null;
  /** asset:// cover URL, or null */
  coverUrl: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CacheStats {
  totalBytes: number;
  limitBytes: number;
  entryCount: number;
  pinnedBytes: number;
}

export interface GameDetailDTO {
  game: GameDTO;
  files: GameFileDTO[];
  media: MediaAssetDTO[];
  saves: SaveDTO[];
}

export interface LibraryQuery {
  systemId?: number | null;
  search?: string;
  favorite?: boolean;
  /** Only games actually played before (last_played_at not null) - backs "Continue playing". */
  playedOnly?: boolean;
  sort?: 'title' | 'lastPlayed' | 'addedAt' | 'playCount';
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface SettingRow {
  key: string;
  /** null for encrypted rows (redacted) */
  value: unknown;
  encrypted: boolean;
}

/** A user-added download source (Settings → Sources). Persisted in settings `sources.custom`. */
export interface CustomSourceDTO {
  id: string;
  kind: 'archive' | 'minerva';
  systemId: number;
  /** Display label (archive item id or Minerva collection). */
  label: string;
  url: string;
  extensions: string[];
  extract: boolean;
}

// ---------------------------------------------------------------------------
// Input payloads
// ---------------------------------------------------------------------------

export interface CreateSystemInput {
  slug: string;
  name: string;
  shortName?: string | null;
  manufacturer?: string | null;
  sortOrder?: number;
  enabled?: boolean;
  iconPath?: string | null;
}

export interface UpdateSystemPatch {
  name?: string;
  shortName?: string | null;
  manufacturer?: string | null;
  sortOrder?: number;
  enabled?: boolean;
  iconPath?: string | null;
}

export interface CreateEmulatorInput {
  name: string;
  /** must originate from emulators:browseForExe; stored verbatim */
  exePath: string;
  workingDir?: string | null;
  defaultArgsTemplate?: string[];
  notes?: string | null;
}

export interface UpdateEmulatorPatch {
  name?: string;
  exePath?: string;
  workingDir?: string | null;
  defaultArgsTemplate?: string[];
  notes?: string | null;
}

export interface UpdateGamePatch {
  title?: string;
  sortTitle?: string;
  favorite?: boolean;
  archived?: boolean;
}

/** rpcs3.net's own rating vocabulary, plus 'Unknown' for an unlisted serial. */
export type CompatStatus = 'Playable' | 'Ingame' | 'Intro' | 'Loadable' | 'Nothing' | 'Unknown';

/** Why a title was flagged as needing setup before it will run well. */
export type PreflightReason =
  /** Rated below Playable, with no per-game config to compensate. */
  | 'compat'
  /** Patches exist for this title in the emulator's patch database, but none are enabled. */
  | 'patches'
  /** A per-game config exists in a DIFFERENT emulator install than the one we launch, so
   *  the emulator will silently ignore it. */
  | 'config-elsewhere'
  /** The launch arguments pass an explicit config file, which makes RPCS3 ignore the
   *  per-game custom config entirely (it switches to config-override mode). */
  | 'config-overridden';

/**
 * Advisory pre-launch readiness report. Purely informational - it never blocks a launch.
 * Non-PS3 systems, unknown serials and already-configured games all report
 * `needsSetup: false` with empty reasons.
 */
export interface LaunchPreflight {
  needsSetup: boolean;
  /** PS3 SERIAL (PARAM.SFO TITLE_ID), e.g. "BCUS98111". NULL when it could not be read. */
  serial: string | null;
  status: CompatStatus;
  /** One-line plain-English meaning of `status`. */
  statusText: string;
  /** True when the rating is a cached value because the compatibility list was unreachable. */
  stale: boolean;
  hasCustomConfig: boolean;
  hasPatches: boolean;
  hasEnabledPatches: boolean;
  /** Display name of the other emulator holding a config for this serial, when applicable. */
  configElsewhere: string | null;
  reasons: PreflightReason[];
}

// ---------------------------------------------------------------------------
// Invoke (request/response) channels
// ---------------------------------------------------------------------------

export interface IpcInvokeMap {
  'app:health': { request: void; response: { ok: true } };

  'systems:list': { request: { enabledOnly?: boolean } | void; response: SystemDTO[] };
  'systems:get': { request: { id: number }; response: SystemDTO | null };
  'systems:create': { request: CreateSystemInput; response: SystemDTO };
  'systems:update': { request: { id: number; patch: UpdateSystemPatch }; response: SystemDTO };
  'systems:delete': { request: { id: number }; response: { deleted: boolean } };
  'systems:setEmulator': {
    request: { systemId: number; emulatorId: number; launchArgsTemplate: string[] };
    response: SystemEmulatorDTO;
  };

  'emulators:list': { request: void; response: EmulatorDTO[] };
  'emulators:get': { request: { id: number }; response: EmulatorDTO | null };
  'emulators:create': { request: CreateEmulatorInput; response: EmulatorDTO };
  'emulators:update': { request: { id: number; patch: UpdateEmulatorPatch }; response: EmulatorDTO };
  'emulators:delete': { request: { id: number }; response: { deleted: boolean } };
  'emulators:browseForExe': { request: void; response: { exePath: string } | null };
  'emulators:getDir': { request: void; response: { dir: string } };
  'emulators:revealDir': { request: void; response: { ok: true } };
  'emulators:scanDir': {
    request: void;
    response: { added: number; found: { name: string; exePath: string }[] };
  };

  'games:list': { request: LibraryQuery; response: { items: GameDTO[]; total: number } };
  'games:search': { request: { query: string; systemId?: number | null }; response: GameDTO[] };
  'games:detail': { request: { id: number }; response: GameDetailDTO | null };
  'games:update': { request: { id: number; patch: UpdateGamePatch }; response: GameDTO };
  // response is null when un-favoriting DELETED a file-less catalog favorite row.
  'games:setFavorite': { request: { id: number; favorite: boolean }; response: GameDTO | null };

  'settings:get': { request: { key: string }; response: SettingRow | null };
  'settings:getMany': { request: { keys: string[] }; response: Record<string, unknown> };
  'settings:set': { request: { key: string; value: unknown; encrypted?: boolean }; response: { ok: true } };

  // User-added download sources (archive.org / Minerva links). The console is chosen by
  // the user; main probes the item's files/format on add.
  'sources:list': { request: void; response: CustomSourceDTO[] };
  'sources:add': { request: { url: string; systemId: number }; response: CustomSourceDTO };
  'sources:remove': { request: { id: string }; response: { ok: true } };
  /** Whether archive.org S3 credentials are configured (presence only - never the values). */
  'sources:archiveStatus': {
    request: void;
    response: { hasKey: boolean; hasSecret: boolean; configured: boolean };
  };

  /** Opens a native folder picker; returns the chosen absolute path verbatim, or null on cancel. */
  'storage:browseForFolder': { request: void; response: { folderPath: string } | null };

  /** Toggle real OS fullscreen on the app window (Big Screen mode). */
  'window:setFullscreen': { request: { fullscreen: boolean }; response: { ok: true } };

  'cache:stats': { request: void; response: CacheStats };
  'cache:evict': { request: { targetBytes?: number }; response: CacheStats };
  'cache:clear': { request: void; response: CacheStats };
  'cache:pin': { request: { gameFileId: number; pinned: boolean }; response: { ok: true } };

  'downloads:list': { request: { state?: DownloadState } | void; response: DownloadDTO[] };
  'downloads:listItems': { request: void; response: DownloadItemDTO[] };
  'downloads:enqueue': { request: { gameFileId: number; priority?: number }; response: DownloadDTO };
  'downloads:pause': { request: { id: number }; response: DownloadDTO };
  'downloads:resume': { request: { id: number }; response: DownloadDTO };
  'downloads:cancel': { request: { id: number }; response: DownloadDTO };

  'library:scan': { request: { systemId: number; prefix?: string }; response: { added: number; updated: number } };
  /**
   * Reconciles a console's own games folder with the library: adopts files the user added,
   * re-points entries at renamed files, and flags entries whose file is gone.
   */
  'library:scanFolder': {
    request: { systemId: number };
    response: { added: number; relinked: number; matched: number; missing: number };
  };
  'library:remove': { request: { gameId: number }; response: { ok: true } };
  // Uninstall: delete downloaded files but keep the library entry (re-installable).
  'library:uninstall': { request: { gameId: number }; response: { ok: true } };
  // One-shot cover upgrade: swap every game's cover for its LaunchBox retail case
  // front ("Box - Front") where one matches. Idempotent; skips already-upgraded rows.
  'library:upgradeBoxart': { request: void; response: { upgraded: number } };

  'launch:start': { request: { gameId: number; gameFileId?: number }; response: { sessionId: number; pid: number } };
  /** Opens a console's emulator on its own (no game), for BIOS/controller/save-state setup. */
  'launch:emulator': { request: { systemId: number }; response: { pid: number } };
  /** Advisory pre-launch readiness check (PS3/RPCS3 today). `needsSetup: false` for every
   *  other system, so the caller can always call it and only act when it says so. */
  'launch:preflight': { request: { gameId: number; gameFileId?: number }; response: LaunchPreflight };
  /** "Don't remind me again" for this game's pre-launch setup check. */
  'launch:dismissReminder': { request: { gameId: number }; response: GameDTO };

  'scrape:enqueue': { request: { gameId: number }; response: { jobId: number } };
  'scrape:candidates': { request: { gameId: number }; response: MetadataMatch[] };
  'scrape:applyManual': {
    request: { gameId: number; provider: MetadataProviderId; providerGameId: string };
    response: GameDTO;
  };
  'scrape:quota': { request: void; response: RateLimitState[] };

  'saves:list': { request: { gameId: number }; response: SaveDTO[] };
  'saves:syncGame': { request: { gameId: number }; response: { ok: true } };
  'saves:syncAll': { request: void; response: { ok: true } };
  'saves:resolveConflict': { request: { saveId: number; keep: 'local' | 'remote' }; response: SaveDTO };
  /** Reveal the save file in the OS file manager (path resolved in main, never sent to the renderer). */
  'saves:reveal': { request: { saveId: number }; response: { ok: true } };
  /** Delete the save file on disk and its row (caller confirms first). */
  'saves:delete': { request: { saveId: number }; response: { ok: true } };

  'catalog:listByPlatform': {
    request: {
      systemId: number;
      search?: string;
      page?: number;
      sort?: CatalogSort;
      /** 'g:<genreId>' or 't:<themeId>' (see CATALOG_FILTER_OPTIONS) */
      filter?: string;
    };
    response: CatalogListResult;
  };
  // systemId (optional) lets the handler enrich with LaunchBox data for that platform.
  'catalog:gameDetails': { request: { igdbId: number; systemId?: number }; response: CatalogGameDetail | null };
  'catalog:availability': {
    request: { igdbId: number; systemId: number };
    // gameId/gameFileId are non-null once the title has been acquired (so a re-opened
    // detail page re-attaches to the in-flight download instead of offering a fresh one).
    response: {
      available: boolean;
      filename?: string;
      sizeBytes?: number;
      gameId?: number | null;
      gameFileId?: number | null;
      /** True when the owned file's bytes are already cached (cache_state = 'cached'),
       *  so a re-opened detail page shows Play instead of re-offering the download. */
      cached?: boolean;
      /** Whether this catalog title is in the user's My List (favorited). */
      favorite: boolean;
    };
  };
  'catalog:download': { request: { igdbId: number; systemId: number }; response: { gameId: number; gameFileId: number } };
  /** Add/remove a CATALOG title to My List. Creates a file-less games row (carrying the
   *  igdb id) on first favorite so an un-owned title can be saved; removes that row on
   *  un-favorite if it still has no files. Returns the resulting game row. */
  'catalog:setFavorite': {
    request: { igdbId: number; systemId: number; favorite: boolean };
    // gameId is null after un-favoriting a file-less row (it's deleted).
    response: { favorite: boolean; gameId: number | null };
  };
  'igdb:status': {
    request: void;
    response: { hasClientId: boolean; hasClientSecret: boolean; configured: boolean };
  };
  'igdb:testConnection': { request: void; response: CatalogConnectionResult };

  /** Opens a vetted external URL (emulator download page) in the user's browser. */
  'app:openExternal': { request: { url: string }; response: { ok: boolean } };

  /** Download + import the LaunchBox metadata DB (settings-triggered). Long-running;
   *  progress arrives on 'launchbox:importProgress'. Returns the imported game count. */
  'launchbox:import': { request: void; response: { gameCount: number } };
  'launchbox:status': {
    request: void;
    response: { importedAt: number | null; gameCount: number; importing: boolean };
  };

  'updates:status': { request: void; response: UpdateStatusDTO };
  /** Manual check (Settings → About). */
  'updates:check': { request: void; response: UpdateStatusDTO };
  /** Quit and install a downloaded update - refused while a game or download is running. */
  'updates:restart': { request: void; response: { ok: boolean; reason?: string } };
  /** Opens the latest-release page; the URL is built in main from the publish config. */
  'updates:openReleasePage': { request: void; response: { ok: true } };

  // Native Ports (recomps). No channel accepts a path or URL - only a registry id / games.id.
  'recomps:list': { request: void; response: RecompDTO[] };
  'recomps:forGame': { request: { gameId: number }; response: RecompDTO[] };
  'recomps:checkUpdates': { request: { id?: string } | void; response: RecompDTO[] };
  /** Install, or update to the latest release. Returns at once; progress via recomps:* events. */
  'recomps:install': { request: { id: string }; response: RecompDTO };
  'recomps:cancel': { request: { id: string }; response: RecompDTO };
  'recomps:rollback': { request: { id: string }; response: RecompDTO };
  'recomps:uninstall': { request: { id: string }; response: RecompDTO };
  'recomps:link': { request: { id: string; gameId: number }; response: RecompDTO };
  'recomps:unlink': { request: { id: string }; response: RecompDTO };
  'recomps:launch': { request: { id: string }; response: { sessionId: number; pid: number } };
  /** 'in-app' delivery helper: shows the linked game file in Explorer. */
  'recomps:revealGameFile': { request: { id: string }; response: { ok: true } };
  'recomps:revealInstall': { request: { id: string }; response: { ok: true } };
}

// ---------------------------------------------------------------------------
// App self-update (electron-updater). Covers Nostalgia itself only.
// ---------------------------------------------------------------------------

export type UpdateState = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error';
/** auto = NSIS install updates itself; notify = portable build, check only; disabled = dev/smoke. */
export type UpdateMode = 'auto' | 'notify' | 'disabled';
export interface UpdateStatusDTO {
  state: UpdateState;
  mode: UpdateMode;
  /** app.getVersion() */
  currentVersion: string;
  /** The available/downloaded version. */
  version: string | null;
  /** Plain text (HTML stripped in main). */
  releaseNotes: string | null;
  fraction: number | null;
  checkedAt: number | null;
  /** Short human message - never a stack trace or URL. */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Event (main -> renderer push) channels
// ---------------------------------------------------------------------------

export interface IpcEventMap {
  'downloads:progress': {
    id: number;
    gameFileId: number;
    fraction: number | null;
    bytesReceived: number;
    bytesTotal: number | null;
    bytesPerSecond: number;
  };
  'downloads:stateChanged': { id: number; gameFileId: number; state: DownloadState; error?: string | null };
  'cache:changed': CacheStats;
  'launch:exited': { sessionId: number; gameId: number; exitCode: number | null };
  'scrape:progress': { jobId: number; gameId: number; state: ScrapeState; message?: string };
  'saves:syncProgress': { saveId: number; gameId: number; fraction: number };
  'saves:syncStateChanged': { saveId: number; gameId: number; syncState: SyncState };
  'launchbox:importProgress': {
    phase: 'downloading' | 'importing' | 'done';
    /** downloading → 0..1; importing → games processed so far. */
    fraction: number | null;
    games: number | null;
  };
  'updates:status': UpdateStatusDTO;
  'updates:progress': { fraction: number; bytesPerSecond: number };
  'recomps:progress': { id: string; fraction: number; bytesReceived: number; bytesTotal: number | null };
  'recomps:stateChanged': { id: string; state: RecompInstallState; error?: string | null };
}

// ---------------------------------------------------------------------------
// Helper aliases
// ---------------------------------------------------------------------------

export type IpcInvokeChannel = keyof IpcInvokeMap;
export type IpcEventChannel = keyof IpcEventMap;
export type IpcRequest<C extends IpcInvokeChannel> = IpcInvokeMap[C]['request'];
export type IpcResponse<C extends IpcInvokeChannel> = IpcInvokeMap[C]['response'];
export type IpcEvent<C extends IpcEventChannel> = IpcEventMap[C];

// ---------------------------------------------------------------------------
// Runtime channel lists (preload allow-list). Kept in sync with the maps by
// the compile-time assertions below - a drift becomes a type error.
// ---------------------------------------------------------------------------

export const IPC_INVOKE_CHANNELS = [
  'app:health',
  'systems:list',
  'systems:get',
  'systems:create',
  'systems:update',
  'systems:delete',
  'systems:setEmulator',
  'emulators:list',
  'emulators:get',
  'emulators:create',
  'emulators:update',
  'emulators:delete',
  'emulators:browseForExe',
  'emulators:getDir',
  'emulators:revealDir',
  'emulators:scanDir',
  'games:list',
  'games:search',
  'games:detail',
  'games:update',
  'games:setFavorite',
  'settings:get',
  'settings:getMany',
  'settings:set',
  'sources:list',
  'sources:add',
  'sources:remove',
  'sources:archiveStatus',
  'storage:browseForFolder',
  'window:setFullscreen',
  'cache:stats',
  'cache:evict',
  'cache:clear',
  'cache:pin',
  'downloads:list',
  'downloads:listItems',
  'downloads:enqueue',
  'downloads:pause',
  'downloads:resume',
  'downloads:cancel',
  'library:scan',
  'library:scanFolder',
  'library:remove',
  'library:uninstall',
  'library:upgradeBoxart',
  'launch:start',
  'launch:emulator',
  'launch:preflight',
  'launch:dismissReminder',
  'scrape:enqueue',
  'scrape:candidates',
  'scrape:applyManual',
  'scrape:quota',
  'saves:list',
  'saves:syncGame',
  'saves:syncAll',
  'saves:resolveConflict',
  'saves:reveal',
  'saves:delete',
  'catalog:listByPlatform',
  'catalog:gameDetails',
  'catalog:availability',
  'catalog:download',
  'catalog:setFavorite',
  'igdb:status',
  'igdb:testConnection',
  'app:openExternal',
  'launchbox:import',
  'launchbox:status',
  'updates:status',
  'updates:check',
  'updates:restart',
  'updates:openReleasePage',
  'recomps:list',
  'recomps:forGame',
  'recomps:checkUpdates',
  'recomps:install',
  'recomps:cancel',
  'recomps:rollback',
  'recomps:uninstall',
  'recomps:link',
  'recomps:unlink',
  'recomps:launch',
  'recomps:revealGameFile',
  'recomps:revealInstall',
] as const;

export const IPC_EVENT_CHANNELS = [
  'downloads:progress',
  'downloads:stateChanged',
  'cache:changed',
  'launch:exited',
  'scrape:progress',
  'saves:syncProgress',
  'saves:syncStateChanged',
  'launchbox:importProgress',
  'updates:status',
  'updates:progress',
  'recomps:progress',
  'recomps:stateChanged',
] as const;

// Bidirectional equality check between the runtime arrays and the map keys.
type Mutual<A extends string, B extends string> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : never
  : never;

const _invokeChannelsMatch: Mutual<IpcInvokeChannel, (typeof IPC_INVOKE_CHANNELS)[number]> = true;
const _eventChannelsMatch: Mutual<IpcEventChannel, (typeof IPC_EVENT_CHANNELS)[number]> = true;
void _invokeChannelsMatch;
void _eventChannelsMatch;
