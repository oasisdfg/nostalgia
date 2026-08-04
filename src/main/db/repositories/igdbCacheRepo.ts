import { getDb } from '../connection';

export function getCached<T>(key: string, ttlMs: number): T | null {
  const row = getDb()
    .prepare('SELECT payload, fetched_at FROM igdb_cache WHERE cache_key = ?')
    .get(key) as { payload: string; fetched_at: number } | undefined;
  if (!row) return null;
  if (Date.now() - row.fetched_at > ttlMs) return null;
  try {
    return JSON.parse(row.payload) as T;
  } catch {
    return null;
  }
}

export function setCached(key: string, value: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO igdb_cache (cache_key, payload, fetched_at) VALUES (?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
    )
    .run(key, JSON.stringify(value), Date.now());
}
