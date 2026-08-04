-- Additive amendments that close gaps the canonical comments imply but the base
-- DDL did not enforce. Forward-only; adds only new columns, indexes, constraints.

-- (A) media_assets dedupe: a game may have many screenshot/fanart rows, but never
--     two identical assets of the same type. Enables INSERT ... ON CONFLICT in
--     mediaCache (checksum MUST be non-NULL on the upsert path).
CREATE UNIQUE INDEX uq_media_assets_dedupe ON media_assets(game_id, type, checksum);

-- (B) saves identity: post-play discovery is an idempotent UPSERT instead of
--     accumulating duplicate rows on every re-scan. slot is nullable, so
--     local_path keeps the key total.
CREATE UNIQUE INDEX uq_saves_identity ON saves(game_id, type, slot, local_path);

-- (C) Three-way save-sync state: capture what the remote was at last successful
--     sync, so the engine distinguishes "remote is newer" from "remote is the
--     version I already have" and detects true conflicts without re-listing.
ALTER TABLE saves ADD COLUMN remote_updated_at INTEGER; -- epoch ms of RemoteSaveRef.updatedAt at last sync
ALTER TABLE saves ADD COLUMN synced_hash TEXT;          -- sha1 hex synced at last sync

-- (D) Back the per-system save-folder query path + ON DELETE CASCADE with an index.
CREATE INDEX idx_saves_system ON saves(system_id);

-- (E) Protect a user's manual metadata pin from a later automatic re-scrape.
ALTER TABLE games ADD COLUMN metadata_locked INTEGER NOT NULL DEFAULT 0
  CHECK (metadata_locked IN (0, 1));

-- (F) Back a global cross-game "recently played sessions" feed.
CREATE INDEX idx_play_sessions_started ON play_sessions(started_at);
