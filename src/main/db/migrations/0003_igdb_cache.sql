-- IGDB response cache (catalog). Keyed by a request signature; payload is JSON;
-- fetched_at drives the TTL. Additive, forward-only.
CREATE TABLE igdb_cache (
  cache_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  fetched_at INTEGER NOT NULL
);
CREATE INDEX idx_igdb_cache_fetched ON igdb_cache(fetched_at);
