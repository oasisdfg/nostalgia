-- RPCS3 pre-launch readiness. A PS3 title's SERIAL (PARAM.SFO's TITLE_ID, e.g.
-- "BCUS98111") is the key that ties a dump to its compatibility rating, its per-game
-- config (config/custom_configs/config_<SERIAL>.yml) and its patches (patches/patch.yml).
-- Read from the dump at download/ingest time; NULL for non-PS3 files and for PS3 dumps
-- whose PARAM.SFO could not be read (degrades to "no reminder", never to a failed launch).
-- Additive, forward-only.
ALTER TABLE game_files ADD COLUMN title_id TEXT;

CREATE INDEX idx_game_files_title_id ON game_files(title_id);

-- Cached emulator compatibility ratings. Keyed by (provider, title_id) rather than by
-- game so one rating serves every copy of a title, and so a second emulator's list can be
-- added later without a schema change. `status` holds the provider's own vocabulary -
-- rpcs3.net returns Playable | Ingame | Intro | Loadable | Nothing - plus 'Unknown' for a
-- serial the list does not cover, which is cached too so we don't re-query it every launch.
CREATE TABLE compat_entries (
  provider   TEXT NOT NULL CHECK (provider IN ('rpcs3')),
  title_id   TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('Playable','Ingame','Intro','Loadable','Nothing','Unknown')),
  title      TEXT,
  checked_at INTEGER NOT NULL,
  PRIMARY KEY (provider, title_id)
);

-- Per-game "don't remind me again" for the pre-launch setup dialog. The reminder is
-- advisory, so dismissing it must never block a launch - it only suppresses the dialog.
ALTER TABLE games ADD COLUMN launch_reminder_dismissed INTEGER NOT NULL DEFAULT 0
  CHECK (launch_reminder_dismissed IN (0,1));
