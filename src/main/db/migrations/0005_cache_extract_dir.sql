-- Some catalog sources ship each game as a per-game .zip (Redump disc images for
-- Xbox 360 / Xbox / PS2 / PSX / PSP). Those emulators can't read a zip, so the
-- DownloadManager extracts the disc image after download and points local_path at
-- the extracted file. When a zip holds MORE THAN ONE inner file (e.g. a PSX .cue +
-- .bin set) it is extracted into a dedicated per-game folder; extract_dir records
-- that folder so eviction/removal can delete the whole set, not just the launch file.
-- NULL for a normal (non-extracted, single-file) cache entry. Opaque path, verbatim.
-- Additive, forward-only.
ALTER TABLE cache_entries ADD COLUMN extract_dir TEXT;
