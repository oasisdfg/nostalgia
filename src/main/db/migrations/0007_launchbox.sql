-- LaunchBox Games Database import (a second metadata source, merged with IGDB on the
-- catalog detail page). The full Metadata.zip (gamesdb.launchbox-app.com) is imported
-- on demand into these tables, keyed by normalized title + platform. Only the consoles
-- Nostalgia maps and only the image types it displays are kept, so the tables stay small
-- relative to the ~500MB source. Additive, forward-only.

-- One row per LaunchBox game (its DatabaseID is the PK). title_norm + platform is the
-- lookup key from an IGDB title; the rest are the enrichment fields.
CREATE TABLE launchbox_games (
  database_id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  title_norm TEXT NOT NULL,
  platform TEXT NOT NULL,
  overview TEXT,
  release_date TEXT,
  genres TEXT,
  developer TEXT,
  publisher TEXT,
  community_rating REAL,
  community_rating_count INTEGER,
  esrb TEXT,
  max_players INTEGER,
  cooperative INTEGER NOT NULL DEFAULT 0 CHECK (cooperative IN (0, 1)),
  video_url TEXT,
  wikipedia_url TEXT
);
CREATE INDEX idx_launchbox_games_lookup ON launchbox_games(title_norm, platform);

-- Alternate/region names, so a title that differs from IGDB's still matches.
CREATE TABLE launchbox_alt_names (
  database_id INTEGER NOT NULL,
  name_norm TEXT NOT NULL
);
CREATE INDEX idx_launchbox_alt_lookup ON launchbox_alt_names(name_norm);

-- Only the image types we render (Clear Logo, Fanart - Background, Banner, Box - Front).
-- file_name is relative to https://images.launchbox-app.com/ (opaque, stored verbatim).
CREATE TABLE launchbox_images (
  database_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  region TEXT
);
CREATE INDEX idx_launchbox_images_game ON launchbox_images(database_id);

-- Single-row import bookkeeping (last import time, source game count).
CREATE TABLE launchbox_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  imported_at INTEGER,
  game_count INTEGER NOT NULL DEFAULT 0
);
