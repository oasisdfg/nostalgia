import { getDb } from '../connection';
import type { CacheStats } from '@shared/contracts/ipc';

export interface CacheEntryRow {
  id: number;
  game_file_id: number | null;
  cache_key: string;
  local_path: string;
  size_bytes: number;
  last_accessed_at: number;
  pinned: number;
  verified: number;
  /** For a zip-extracted, multi-file game: the per-game folder to remove wholesale. NULL otherwise. */
  extract_dir: string | null;
}

export function getCacheStats(): CacheStats {
  const db = getDb();
  const agg = db
    .prepare(
      `SELECT COALESCE(SUM(size_bytes), 0) AS total,
              COUNT(*) AS cnt,
              COALESCE(SUM(CASE WHEN pinned = 1 THEN size_bytes ELSE 0 END), 0) AS pinned
       FROM cache_entries`,
    )
    .get() as { total: number; cnt: number; pinned: number };

  const limitRow = db
    .prepare("SELECT value FROM settings WHERE key = 'cache.sizeLimitBytes' AND encrypted = 0")
    .get() as { value: string | null } | undefined;
  let limitBytes = 0;
  if (limitRow?.value != null) {
    try {
      limitBytes = Number(JSON.parse(limitRow.value)) || 0;
    } catch {
      limitBytes = 0;
    }
  }
  return { totalBytes: agg.total, limitBytes, entryCount: agg.cnt, pinnedBytes: agg.pinned };
}

export function getEntryByKey(cacheKey: string): CacheEntryRow | undefined {
  return getDb().prepare('SELECT * FROM cache_entries WHERE cache_key = ?').get(cacheKey) as CacheEntryRow | undefined;
}

export function getEntryByFile(gameFileId: number): CacheEntryRow | undefined {
  return getDb().prepare('SELECT * FROM cache_entries WHERE game_file_id = ?').get(gameFileId) as
    | CacheEntryRow
    | undefined;
}

export function upsertEntry(entry: {
  gameFileId: number | null;
  cacheKey: string;
  localPath: string;
  sizeBytes: number;
  verified: boolean;
  extractDir?: string | null;
}): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO cache_entries (game_file_id, cache_key, local_path, size_bytes, last_accessed_at, pinned, verified, extract_dir, created_at)
       VALUES (@gameFileId, @cacheKey, @localPath, @sizeBytes, @now, 0, @verified, @extractDir, @now)
       ON CONFLICT(cache_key) DO UPDATE SET
         game_file_id = excluded.game_file_id,
         local_path = excluded.local_path,
         size_bytes = excluded.size_bytes,
         last_accessed_at = excluded.last_accessed_at,
         verified = excluded.verified,
         extract_dir = excluded.extract_dir`,
    )
    .run({
      gameFileId: entry.gameFileId,
      cacheKey: entry.cacheKey,
      localPath: entry.localPath,
      sizeBytes: entry.sizeBytes,
      verified: entry.verified ? 1 : 0,
      extractDir: entry.extractDir ?? null,
      now,
    });
}

export function touchEntry(cacheKey: string): void {
  getDb().prepare('UPDATE cache_entries SET last_accessed_at = ? WHERE cache_key = ?').run(Date.now(), cacheKey);
}

export function setPinnedByFile(gameFileId: number, pinned: boolean): void {
  getDb().prepare('UPDATE cache_entries SET pinned = ? WHERE game_file_id = ?').run(pinned ? 1 : 0, gameFileId);
}

/** Unpinned entries, least-recently-used first (eviction order). */
export function listEvictable(): CacheEntryRow[] {
  return getDb()
    .prepare('SELECT * FROM cache_entries WHERE pinned = 0 ORDER BY last_accessed_at ASC')
    .all() as CacheEntryRow[];
}

export function listAllEntries(): CacheEntryRow[] {
  return getDb().prepare('SELECT * FROM cache_entries').all() as CacheEntryRow[];
}

export function deleteEntry(id: number): void {
  getDb().prepare('DELETE FROM cache_entries WHERE id = ?').run(id);
}
