-- Native Ports v2: files the user picks through an OS dialog (games Nostalgia doesn't manage,
-- e.g. PS4 dumps), the exe of a port that installs itself ('external'), and a cache of the
-- original game's art per port. Paths are opaque and stored verbatim. Additive, forward-only.
ALTER TABLE recomp_installs ADD COLUMN picked_path TEXT;          -- opaque; from recomps:pickGameFiles
ALTER TABLE recomp_installs ADD COLUMN external_exe_path TEXT;    -- opaque; from recomps:locateExe
CREATE TABLE recomp_art (
  recomp_id TEXT PRIMARY KEY,
  cover_path TEXT,      -- opaque, under assets/
  hero_path TEXT,       -- opaque, under assets/
  checked_at INTEGER NOT NULL
);
