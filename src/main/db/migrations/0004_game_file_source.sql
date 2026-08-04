-- Which provider supplies a game_file's bytes: 'local' (LocalFolder ingest) or a
-- catalog download source like 'archive-org'. Lets the DownloadManager route each
-- file to the right provider. Additive, forward-only.
ALTER TABLE game_files ADD COLUMN source TEXT NOT NULL DEFAULT 'local';
