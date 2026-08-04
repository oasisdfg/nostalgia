-- Nostalgia canonical schema. IMMUTABLE once shipped — never edit this file.
-- Additive changes go in new numbered migrations (0002_schema_amendments.sql, ...).
-- Conventions: timestamps are INTEGER epoch milliseconds; booleans are
-- INTEGER CHECK(col IN (0,1)); enums are TEXT with CHECK; JSON columns are TEXT
-- with CHECK(json_valid(col)); opaque paths/keys are TEXT stored verbatim.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);

-- Emulators: a configured emulator program. exe_path/working_dir are opaque.
CREATE TABLE emulators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  exe_path TEXT NOT NULL,
  working_dir TEXT,
  default_args_template TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(default_args_template)),
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Systems: a platform/console. Ships with 10 named platforms plus user-added.
CREATE TABLE systems (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  short_name TEXT,
  manufacturer TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  is_builtin INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0, 1)),
  default_emulator_id INTEGER REFERENCES emulators(id) ON DELETE SET NULL,
  icon_path TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_systems_sort ON systems(sort_order, name);

-- Per-system emulator binding + per-system launch-arg template (JSON string[]).
CREATE TABLE system_emulator (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  system_id INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
  emulator_id INTEGER NOT NULL REFERENCES emulators(id) ON DELETE CASCADE,
  launch_args_template TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(launch_args_template)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- At most one active emulator per system; at most one row per (system, emulator).
CREATE UNIQUE INDEX uq_system_emulator_active ON system_emulator(system_id) WHERE is_active = 1;
CREATE UNIQUE INDEX uq_system_emulator_pair ON system_emulator(system_id, emulator_id);

-- Games: a logical title. Per-game metadata that is not per-file.
CREATE TABLE games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  system_id INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sort_title TEXT NOT NULL,
  region TEXT,
  language TEXT,
  description TEXT,
  release_date TEXT,
  genre TEXT,
  players INTEGER,
  rating REAL,
  favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
  last_played_at INTEGER,
  play_count INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_games_system_sort ON games(system_id, sort_title);
CREATE INDEX idx_games_last_played ON games(last_played_at);
CREATE INDEX idx_games_favorite ON games(favorite);
CREATE INDEX idx_games_added ON games(added_at);

-- Game files: one or more files per game (multi-disc). storage_key is opaque.
CREATE TABLE game_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  display_name TEXT,
  size_bytes INTEGER,
  crc32 TEXT,
  md5 TEXT,
  sha1 TEXT,
  hash_source TEXT NOT NULL DEFAULT 'none' CHECK (hash_source IN ('manifest', 'post_download', 'none')),
  disc_no INTEGER,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  cache_state TEXT NOT NULL DEFAULT 'remote' CHECK (cache_state IN ('remote', 'downloading', 'cached', 'stale', 'error')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (game_id, storage_key)
);
CREATE INDEX idx_game_files_game ON game_files(game_id);
CREATE INDEX idx_game_files_crc32 ON game_files(crc32);
CREATE INDEX idx_game_files_md5 ON game_files(md5);
CREATE INDEX idx_game_files_sha1 ON game_files(sha1);
CREATE UNIQUE INDEX uq_game_files_primary ON game_files(game_id) WHERE is_primary = 1;

-- Metadata: cached scrape result, one row per provider per game.
CREATE TABLE metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('screenscraper', 'thegamesdb')),
  provider_game_id TEXT,
  raw_json TEXT CHECK (raw_json IS NULL OR json_valid(raw_json)),
  matched_by TEXT CHECK (matched_by IS NULL OR matched_by IN ('hash', 'filename', 'title', 'manual')),
  match_confidence REAL,
  scraped_at INTEGER NOT NULL,
  UNIQUE (game_id, provider)
);

-- Media assets: art cached on disk; row stores the local path + checksum.
CREATE TABLE media_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('box2d', 'box3d', 'wheel', 'logo', 'marquee', 'screenshot', 'fanart', 'video')),
  local_path TEXT NOT NULL,
  source_url TEXT,
  provider TEXT CHECK (provider IS NULL OR provider IN ('screenscraper', 'thegamesdb')),
  width INTEGER,
  height INTEGER,
  checksum TEXT,
  downloaded_at INTEGER NOT NULL
);
CREATE INDEX idx_media_assets_game ON media_assets(game_id);

-- Downloads: on-demand fetch queue + resume state for a game_file.
CREATE TABLE downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_file_id INTEGER NOT NULL REFERENCES game_files(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'downloading', 'paused', 'verifying', 'completed', 'failed', 'canceled')),
  bytes_total INTEGER,
  bytes_received INTEGER NOT NULL DEFAULT 0,
  resume_offset INTEGER NOT NULL DEFAULT 0,
  etag TEXT,
  last_modified TEXT,
  temp_path TEXT,
  checksum_expected TEXT,
  checksum_algo TEXT CHECK (checksum_algo IS NULL OR checksum_algo IN ('crc32', 'md5', 'sha1')),
  error TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- checksum coupling: both set together or both NULL, so verify never no-ops.
  CHECK ((checksum_expected IS NULL) = (checksum_algo IS NULL))
);
CREATE UNIQUE INDEX uq_downloads_active ON downloads(game_file_id)
  WHERE state IN ('queued', 'downloading', 'paused', 'verifying');
CREATE INDEX idx_downloads_state ON downloads(state, priority DESC, created_at);

-- Cache entries: LRU accounting for the on-demand cache. cache_key is opaque.
CREATE TABLE cache_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_file_id INTEGER REFERENCES game_files(id) ON DELETE CASCADE,
  cache_key TEXT NOT NULL UNIQUE,
  local_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  last_accessed_at INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_cache_entries_lru ON cache_entries(pinned, last_accessed_at);
CREATE INDEX idx_cache_entries_game ON cache_entries(game_file_id);

-- Saves: save states / memory cards per game, with sync state. local_path opaque.
CREATE TABLE saves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  system_id INTEGER NOT NULL REFERENCES systems(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('savestate', 'memorycard', 'sram', 'other')),
  slot INTEGER,
  local_path TEXT NOT NULL,
  size_bytes INTEGER,
  crc32 TEXT,
  md5 TEXT,
  sha1 TEXT,
  sync_state TEXT NOT NULL DEFAULT 'local_only' CHECK (sync_state IN ('local_only', 'synced', 'pending_upload', 'pending_download', 'conflict')),
  remote_id TEXT,
  updated_at INTEGER NOT NULL,
  last_synced_at INTEGER
);
CREATE INDEX idx_saves_game ON saves(game_id);
CREATE INDEX idx_saves_sync_state ON saves(sync_state);

-- Settings: generic key/value. Secret values are safeStorage-encrypted with
-- encrypted = 1 (value holds base64 ciphertext); others hold plain JSON.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  encrypted INTEGER NOT NULL DEFAULT 0 CHECK (encrypted IN (0, 1)),
  updated_at INTEGER NOT NULL
);

-- Scrape jobs: scraping queue + progress.
CREATE TABLE scrape_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'canceled', 'no_match')),
  provider_chain TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(provider_chain)),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX uq_scrape_jobs_active ON scrape_jobs(game_id) WHERE state IN ('queued', 'running');
CREATE INDEX idx_scrape_jobs_state ON scrape_jobs(state);

-- Play sessions: one row per launch; source for denormalized play stats.
CREATE TABLE play_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  game_file_id INTEGER REFERENCES game_files(id) ON DELETE SET NULL,
  emulator_id INTEGER REFERENCES emulators(id) ON DELETE SET NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  exit_code INTEGER
);
CREATE INDEX idx_play_sessions_game ON play_sessions(game_id, started_at);
