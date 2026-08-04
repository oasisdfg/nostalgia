-- Home page + "My Games" (favorites that include titles you haven't downloaded).
--
-- A favorite is `games.favorite = 1`. To let the user favorite a CATALOG title they
-- don't own yet (from search/home/detail), we create a file-less `games` row carrying
-- the IGDB id it came from. `games.igdb_id` links that row back to the catalog so a
-- later download attaches its `game_files` to the SAME row (favorite-then-download
-- converges) rather than duplicating the game.
--
-- Uniqueness is per (system_id, igdb_id): the same IGDB title released on two consoles
-- (e.g. a PS2 + Xbox game) is legitimately two library entries, mirroring how owned
-- downloads are per-system. Partial index so the many pre-existing local/ingested rows
-- (igdb_id NULL) are unconstrained. Additive, forward-only.
ALTER TABLE games ADD COLUMN igdb_id INTEGER;

CREATE UNIQUE INDEX uq_games_system_igdb ON games(system_id, igdb_id) WHERE igdb_id IS NOT NULL;
