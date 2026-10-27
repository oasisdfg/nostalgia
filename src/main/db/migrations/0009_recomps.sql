-- Native Ports (recomps). One row per registry port the user has touched: its install on
-- disk under recomps.dir (<recomps.dir>/<id>/<tag>), the cached GitHub release check, and
-- the link to the user's own copy of the original game. Additive, forward-only.
CREATE TABLE recomp_installs (
  recomp_id TEXT PRIMARY KEY,                    -- RecompManifest.id
  state TEXT NOT NULL DEFAULT 'not_installed'
    CHECK (state IN ('not_installed','downloading','verifying','extracting','installed','failed')),
  installed_tag TEXT,
  install_dir TEXT,                              -- opaque, <recomps.dir>/<id>/<tag>
  exe_path TEXT,                                 -- opaque, resolved by main inside install_dir
  previous_tag TEXT,                             -- kept on disk for one-click rollback
  previous_dir TEXT,
  latest_tag TEXT,
  latest_checked_at INTEGER,
  etag TEXT,                                     -- GitHub API conditional request
  linked_game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
  file_delivered INTEGER NOT NULL DEFAULT 0 CHECK (file_delivered IN (0,1)),
  last_error TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_recomp_installs_game ON recomp_installs(linked_game_id);

-- A session can be a port run instead of an emulator run.
ALTER TABLE play_sessions ADD COLUMN recomp_id TEXT;
