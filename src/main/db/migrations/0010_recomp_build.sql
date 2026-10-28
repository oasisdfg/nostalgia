-- Native Ports R3: ports built from source on the user's PC get their own 'building' state.
-- SQLite can't alter a CHECK constraint, so recomp_installs is rebuilt with the wider enum
-- and every row copied across unchanged. Nothing references this table, so the swap is
-- safe with foreign keys on. Forward-only.
CREATE TABLE recomp_installs_new (
  recomp_id TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'not_installed'
    CHECK (state IN ('not_installed','downloading','verifying','extracting','building','installed','failed')),
  installed_tag TEXT,
  install_dir TEXT,
  exe_path TEXT,
  previous_tag TEXT,
  previous_dir TEXT,
  latest_tag TEXT,
  latest_checked_at INTEGER,
  etag TEXT,
  linked_game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
  file_delivered INTEGER NOT NULL DEFAULT 0 CHECK (file_delivered IN (0,1)),
  last_error TEXT,
  updated_at INTEGER NOT NULL
);
INSERT INTO recomp_installs_new SELECT
  recomp_id, state, installed_tag, install_dir, exe_path, previous_tag, previous_dir, latest_tag,
  latest_checked_at, etag, linked_game_id, file_delivered, last_error, updated_at
FROM recomp_installs;
DROP TABLE recomp_installs;
ALTER TABLE recomp_installs_new RENAME TO recomp_installs;
CREATE INDEX idx_recomp_installs_game ON recomp_installs(linked_game_id);
