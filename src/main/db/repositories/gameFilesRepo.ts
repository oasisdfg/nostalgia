import { getDb } from '../connection';
import { mapGameFile, type GameFileRow } from './types';
import type { GameFileDTO, HashSource, CacheState } from '@shared/contracts/ipc';

const COLS =
  'id, game_id, storage_key, display_name, size_bytes, crc32, md5, sha1, hash_source, disc_no, is_primary, cache_state, source, created_at, updated_at';

export function getFileRow(id: number): GameFileRow | undefined {
  return getDb().prepare(`SELECT ${COLS} FROM game_files WHERE id = ?`).get(id) as GameFileRow | undefined;
}

export function getFile(id: number): GameFileDTO | null {
  const r = getFileRow(id);
  return r ? mapGameFile(r) : null;
}

/** storage_keys of OWNED (catalog-downloaded, source != 'local') files in a system. */
export function listOwnedStorageKeys(systemId: number): string[] {
  return (
    getDb()
      .prepare(
        `SELECT gf.storage_key AS k FROM game_files gf JOIN games g ON g.id = gf.game_id
           WHERE g.system_id = ? AND gf.source != 'local'`,
      )
      .all(systemId) as { k: string }[]
  ).map((r) => r.k);
}

/** Every file row belonging to a system, with its cached on-disk path when it has one. */
export function listFilesForSystem(systemId: number): (GameFileRow & { local_path: string | null })[] {
  return getDb()
    .prepare(
      `SELECT ${COLS.split(', ')
        .map((c) => `gf.${c}`)
        .join(', ')}, ce.local_path AS local_path
         FROM game_files gf
         JOIN games g ON g.id = gf.game_id
         LEFT JOIN cache_entries ce ON ce.game_file_id = gf.id
         WHERE g.system_id = ?`,
    )
    .all(systemId) as (GameFileRow & { local_path: string | null })[];
}

/**
 * Points an existing file row at a DIFFERENT on-disk name after the user renamed it.
 * Keeps the game (and its art, play history and favourites) and only swaps the opaque
 * key - the alternative was orphaning the row and prompting a re-download of a file that
 * is sitting right there. `storage_key` is stored verbatim, never normalized.
 */
export function relinkFile(id: number, storageKey: string, displayName: string): void {
  getDb()
    .prepare('UPDATE game_files SET storage_key = ?, display_name = ?, updated_at = ? WHERE id = ?')
    .run(storageKey, displayName, Date.now(), id);
}

export function getFileByStorageKey(storageKey: string): GameFileRow | undefined {
  return getDb().prepare(`SELECT ${COLS} FROM game_files WHERE storage_key = ?`).get(storageKey) as
    | GameFileRow
    | undefined;
}

/** Resolves the primary file for a game (or any file as a fallback). */
export function getPrimaryFileForGame(gameId: number): GameFileRow | undefined {
  const db = getDb();
  return (
    (db.prepare(`SELECT ${COLS} FROM game_files WHERE game_id = ? AND is_primary = 1`).get(gameId) as
      | GameFileRow
      | undefined) ??
    (db.prepare(`SELECT ${COLS} FROM game_files WHERE game_id = ? ORDER BY disc_no, id LIMIT 1`).get(gameId) as
      | GameFileRow
      | undefined)
  );
}

/** Files NOT marked cached that nevertheless own a cache_entries row - the candidates for
 *  the startup cache_state repair (a stale download row can leave an installed game
 *  marked 'remote'/'error'). */
export function listFilesNotCached(): GameFileRow[] {
  return getDb()
    .prepare(
      `SELECT ${COLS.split(', ')
        .map((c) => `gf.${c}`)
        .join(', ')}
         FROM game_files gf JOIN cache_entries ce ON ce.game_file_id = gf.id
         WHERE gf.cache_state != 'cached'`,
    )
    .all() as GameFileRow[];
}

export function setCacheState(id: number, cacheState: CacheState): void {
  getDb().prepare('UPDATE game_files SET cache_state = ?, updated_at = ? WHERE id = ?').run(cacheState, Date.now(), id);
}

/** Records a PS3 title's SERIAL once read from its PARAM.SFO, so later launches skip the
 *  disc read. Stored verbatim (uppercase as it appears in the SFO). */
export function setTitleId(id: number, titleId: string): void {
  getDb().prepare('UPDATE game_files SET title_id = ?, updated_at = ? WHERE id = ?').run(titleId, Date.now(), id);
}

/** Deletes every game_file for a game (FK-cascades cache_entries + downloads). Used by
 *  "uninstall" - the games row itself is kept so the title stays in the library. */
export function deleteFilesForGame(gameId: number): void {
  getDb().prepare('DELETE FROM game_files WHERE game_id = ?').run(gameId);
}

export function setHashes(
  id: number,
  hashes: { crc32: string | null; md5: string | null; sha1: string | null },
  source: HashSource,
): void {
  getDb()
    .prepare('UPDATE game_files SET crc32 = ?, md5 = ?, sha1 = ?, hash_source = ?, updated_at = ? WHERE id = ?')
    .run(hashes.crc32, hashes.md5, hashes.sha1, source, Date.now(), id);
}

export interface IngestFileInput {
  systemId: number;
  title: string;
  /** Attach to this existing games row instead of creating one (a file-less catalog /
   *  My List entry the adopted file belongs to). Omit to create a new game. */
  gameId?: number;
  storageKey: string;
  sizeBytes: number | null;
  crc32: string | null;
  md5: string | null;
  sha1: string | null;
  hashSource: HashSource;
}

/**
 * Idempotent ingest of one remote file. Existing rows (matched by the opaque
 * storage_key) are updated; new ones create a game + its primary file. Returns
 * whether a row was added or updated.
 */
export function upsertIngestedFile(input: IngestFileInput): 'added' | 'updated' {
  const db = getDb();
  const existing = getFileByStorageKey(input.storageKey);
  const now = Date.now();
  if (existing) {
    db.prepare(
      'UPDATE game_files SET size_bytes = ?, crc32 = ?, md5 = ?, sha1 = ?, hash_source = ?, updated_at = ? WHERE id = ?',
    ).run(input.sizeBytes, input.crc32, input.md5, input.sha1, input.hashSource, now, existing.id);
    return 'updated';
  }
  const tx = db.transaction(() => {
    let gameId = input.gameId;
    if (gameId == null) {
      const game = db
        .prepare('INSERT INTO games (system_id, title, sort_title, added_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(input.systemId, input.title, input.title.toLowerCase(), now, now);
      gameId = Number(game.lastInsertRowid);
    }
    db.prepare(
      `INSERT INTO game_files (game_id, storage_key, display_name, size_bytes, crc32, md5, sha1, hash_source, is_primary, cache_state, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'remote', ?, ?)`,
    ).run(gameId, input.storageKey, input.title, input.sizeBytes, input.crc32, input.md5, input.sha1, input.hashSource, now, now);
  });
  tx();
  return 'added';
}

/**
 * Acquires a catalog game from a download-source provider: creates a game + its
 * primary game_file with source set (e.g. 'archive-org') and the manifest md5,
 * so the DownloadManager routes + verifies it. Idempotent by storage_key.
 */
export function upsertArchiveFile(input: {
  systemId: number;
  title: string;
  storageKey: string;
  sizeBytes: number;
  md5: string | null;
  source: string;
  /** IGDB id this download came from - converges onto a pre-existing favorite row. */
  igdbId?: number | null;
}): { gameId: number; gameFileId: number } {
  const db = getDb();
  const existing = getFileByStorageKey(input.storageKey);
  if (existing) return { gameId: existing.game_id, gameFileId: existing.id };
  const now = Date.now();
  const hashSource = input.md5 ? 'manifest' : 'none';
  const tx = db.transaction(() => {
    // Converge on a pre-existing games row for this catalog title (e.g. a file-less
    // favorite created before download) instead of creating a duplicate; otherwise
    // create the owned game. Stamp igdb_id so a future favorite also converges.
    let gameId: number | undefined;
    if (input.igdbId != null) {
      const row = db
        .prepare('SELECT id FROM games WHERE system_id = ? AND igdb_id = ?')
        .get(input.systemId, input.igdbId) as { id: number } | undefined;
      gameId = row?.id;
    }
    if (gameId == null) {
      const game = db
        .prepare('INSERT INTO games (system_id, igdb_id, title, sort_title, added_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(input.systemId, input.igdbId ?? null, input.title, input.title.toLowerCase(), now, now);
      gameId = Number(game.lastInsertRowid);
    }
    const file = db
      .prepare(
        `INSERT INTO game_files (game_id, storage_key, display_name, size_bytes, md5, hash_source, is_primary, cache_state, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, 'remote', ?, ?, ?)`,
      )
      .run(gameId, input.storageKey, input.title, input.sizeBytes, input.md5, hashSource, input.source, now, now);
    return { gameId, gameFileId: Number(file.lastInsertRowid) };
  });
  return tx();
}
