import { getDb } from '../connection';
import { mapGame, mapGameFile, toAssetUrl, type GameRow, type GameFileRow } from './types';
import { listMediaForGame } from './mediaRepo';
import { listSavesForGame } from './savesRepo';
import { normalizeLbTitle } from '../../launchbox/normalizeTitle';
import type { GameDTO, GameFileDTO, GameDetailDTO, LibraryQuery, UpdateGamePatch } from '@shared/contracts/ipc';

const GAME_COLS =
  'id, system_id, igdb_id, title, sort_title, region, language, description, release_date, genre, players, rating, favorite, last_played_at, play_count, added_at, archived, metadata_locked, launch_reminder_dismissed, updated_at';
const FILE_COLS =
  'id, game_id, storage_key, display_name, size_bytes, crc32, md5, sha1, hash_source, disc_no, is_primary, cache_state, title_id, created_at, updated_at';

// Whether a game owns at least one file (vs a file-less "My List" favorite).
const HAS_FILES = 'EXISTS (SELECT 1 FROM game_files gf WHERE gf.game_id = games.id) AS has_files';

const SORT_COLUMN: Record<NonNullable<LibraryQuery['sort']>, string> = {
  title: 'sort_title',
  lastPlayed: 'last_played_at',
  addedAt: 'added_at',
  playCount: 'play_count',
};

export function getGame(id: number): GameDTO | null {
  const r = getDb().prepare(`SELECT ${GAME_COLS}, ${HAS_FILES} FROM games WHERE id = ?`).get(id) as
    | (GameRow & { has_files: number })
    | undefined;
  return r ? mapGame(r) : null;
}

/** The games row for a catalog title on a system, if one exists (favorite and/or owned). */
export function findBySystemIgdb(systemId: number, igdbId: number): (GameRow & { has_files: number }) | undefined {
  return getDb()
    .prepare(`SELECT ${GAME_COLS}, ${HAS_FILES} FROM games WHERE system_id = ? AND igdb_id = ?`)
    .get(systemId, igdbId) as (GameRow & { has_files: number }) | undefined;
}

/**
 * The file-less games row on this system whose title matches `title` - i.e. the catalog /
 * My List entry a file the user dropped into the console's folder actually belongs to.
 * Titles are compared normalized (`normalizeLbTitle`: case, punctuation and articles
 * folded), because a filename rarely spells the catalog title character for character.
 * DISPLAY-string matching only; the file's opaque storage_key is untouched.
 */
export function findFilelessGameByTitle(systemId: number, title: string): number | null {
  const want = normalizeLbTitle(title);
  if (!want) return null;
  const rows = getDb()
    .prepare(`SELECT id, title FROM games WHERE system_id = ? AND NOT ${HAS_FILES.replace(' AS has_files', '')}`)
    .all(systemId) as { id: number; title: string }[];
  return rows.find((r) => normalizeLbTitle(r.title) === want)?.id ?? null;
}

/** Every game's id/title/system, for the one-shot box-front cover upgrade pass. */
export function listForBoxartUpgrade(): { id: number; title: string; systemId: number }[] {
  return getDb().prepare(`SELECT id, title, system_id AS systemId FROM games ORDER BY id`).all() as {
    id: number;
    title: string;
    systemId: number;
  }[];
}

export function listGameFiles(gameId: number): GameFileDTO[] {
  return (
    getDb().prepare(`SELECT ${FILE_COLS} FROM game_files WHERE game_id = ? ORDER BY disc_no, id`).all(gameId) as GameFileRow[]
  ).map(mapGameFile);
}

export function listGames(query: LibraryQuery): { items: GameDTO[]; total: number } {
  const where: string[] = ['archived = 0'];
  const params: Record<string, unknown> = {};
  if (query.systemId != null) {
    where.push('system_id = @systemId');
    params.systemId = query.systemId;
  }
  if (query.favorite) where.push('favorite = 1');
  if (query.playedOnly) where.push('last_played_at IS NOT NULL');
  if (query.search) {
    where.push('(title LIKE @search OR sort_title LIKE @search)');
    params.search = `%${query.search}%`;
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const sortCol = SORT_COLUMN[query.sort ?? 'title'];
  const order = query.order === 'desc' ? 'DESC' : 'ASC';
  const limit = query.limit ?? 200;
  const offset = query.offset ?? 0;

  const db = getDb();
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM games ${whereSql}`).get(params) as { c: number }).c;
  // Join the box art (media_assets type 'box2d') so library cards can show cover art.
  const rows = db
    .prepare(
      `SELECT ${GAME_COLS}, ${HAS_FILES},
              (SELECT ma.local_path FROM media_assets ma
                 WHERE ma.game_id = games.id AND ma.type = 'box2d' ORDER BY ma.id LIMIT 1) AS cover_path
         FROM games ${whereSql}
         ORDER BY ${sortCol} ${order}, sort_title ASC LIMIT @limit OFFSET @offset`,
    )
    .all({ ...params, limit, offset }) as (GameRow & { has_files: number; cover_path: string | null })[];
  const items = rows.map((r) => ({ ...mapGame(r), coverUrl: r.cover_path ? toAssetUrl(r.cover_path) : null }));
  return { items, total };
}

export function searchGames(queryText: string, systemId?: number | null): GameDTO[] {
  const where = ['archived = 0', '(title LIKE @q OR sort_title LIKE @q)'];
  const params: Record<string, unknown> = { q: `%${queryText}%` };
  if (systemId != null) {
    where.push('system_id = @systemId');
    params.systemId = systemId;
  }
  return (
    getDb()
      .prepare(`SELECT ${GAME_COLS}, ${HAS_FILES} FROM games WHERE ${where.join(' AND ')} ORDER BY sort_title LIMIT 100`)
      .all(params) as (GameRow & { has_files: number })[]
  ).map(mapGame);
}

/** Which of the given IGDB ids are favorited on this system (for marking catalog cards). */
export function favoritedIgdbIdsForSystem(systemId: number, igdbIds: number[]): Set<number> {
  if (igdbIds.length === 0) return new Set();
  const placeholders = igdbIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT igdb_id AS id FROM games
         WHERE system_id = ? AND favorite = 1 AND igdb_id IN (${placeholders})`,
    )
    .all(systemId, ...igdbIds) as { id: number }[];
  return new Set(rows.map((r) => r.id));
}

/**
 * Creates a file-less "My List" favorite for a catalog title (no download yet), carrying
 * the IGDB id so a later download converges onto this same row (see upsertArchiveFile).
 * Idempotent: if a row already exists for (system, igdb) it's just marked favorite.
 */
export function createCatalogFavorite(input: {
  systemId: number;
  igdbId: number;
  title: string;
  releaseDate: string | null;
  genre: string | null;
}): GameDTO {
  const existing = findBySystemIgdb(input.systemId, input.igdbId);
  if (existing) return setFavorite(existing.id, true);
  const now = Date.now();
  const info = getDb()
    .prepare(
      `INSERT INTO games (system_id, igdb_id, title, sort_title, release_date, genre, favorite, added_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(input.systemId, input.igdbId, input.title, input.title.toLowerCase(), input.releaseDate, input.genre, now, now);
  return getGame(Number(info.lastInsertRowid))!;
}

export function getGameDetail(id: number): GameDetailDTO | null {
  const game = getGame(id);
  if (!game) return null;
  // Attach the box art so the detail pop-out can show it (thumbnail + blurred backdrop),
  // matching how listGames projects coverUrl for the grid cards.
  const cover = getDb()
    .prepare(`SELECT local_path FROM media_assets WHERE game_id = ? AND type = 'box2d' ORDER BY id LIMIT 1`)
    .get(id) as { local_path: string } | undefined;
  return {
    game: { ...game, coverUrl: cover ? toAssetUrl(cover.local_path) : null },
    files: listGameFiles(id),
    media: listMediaForGame(id),
    saves: listSavesForGame(id),
  };
}

export function updateGame(id: number, patch: UpdateGamePatch): GameDTO {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id, updated_at: Date.now() };
  const set = (col: string, val: unknown): void => {
    sets.push(`${col} = @${col}`);
    params[col] = val;
  };
  if (patch.title !== undefined) set('title', patch.title);
  if (patch.sortTitle !== undefined) set('sort_title', patch.sortTitle);
  if (patch.favorite !== undefined) set('favorite', patch.favorite ? 1 : 0);
  if (patch.archived !== undefined) set('archived', patch.archived ? 1 : 0);
  sets.push('updated_at = @updated_at');
  getDb().prepare(`UPDATE games SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return getGame(id)!;
}

/** Suppresses the pre-launch setup reminder for this game ("don't remind me again"). */
export function setLaunchReminderDismissed(id: number, dismissed: boolean): GameDTO {
  getDb()
    .prepare('UPDATE games SET launch_reminder_dismissed = ?, updated_at = ? WHERE id = ?')
    .run(dismissed ? 1 : 0, Date.now(), id);
  return getGame(id)!;
}

export function setFavorite(id: number, favorite: boolean): GameDTO {
  getDb()
    .prepare('UPDATE games SET favorite = ?, updated_at = ? WHERE id = ?')
    .run(favorite ? 1 : 0, Date.now(), id);
  return getGame(id)!;
}

export interface GameRemovalPaths {
  fileIds: number[];
  blobs: string[]; // cached game files (cache_entries.local_path)
  dirs: string[]; // per-game zip-extraction folders (cache_entries.extract_dir), removed recursively
  parts: string[]; // in-flight .part temp files (downloads.temp_path)
  media: string[]; // cached art (media_assets.local_path)
}

/** Gather every on-disk path tied to a game BEFORE the cascading row delete drops
 *  the join rows. The caller removes the files (FK cascade only handles DB rows). */
export function collectGameRemovalPaths(gameId: number): GameRemovalPaths {
  const db = getDb();
  const col = (sql: string): string[] => (db.prepare(sql).all(gameId) as { p: string }[]).map((r) => r.p);
  return {
    fileIds: (db.prepare('SELECT id AS p FROM game_files WHERE game_id = ?').all(gameId) as { p: number }[]).map(
      (r) => r.p,
    ),
    blobs: col(
      'SELECT ce.local_path AS p FROM cache_entries ce JOIN game_files gf ON ce.game_file_id = gf.id WHERE gf.game_id = ?',
    ),
    dirs: col(
      'SELECT ce.extract_dir AS p FROM cache_entries ce JOIN game_files gf ON ce.game_file_id = gf.id WHERE gf.game_id = ? AND ce.extract_dir IS NOT NULL',
    ),
    parts: col(
      'SELECT d.temp_path AS p FROM downloads d JOIN game_files gf ON d.game_file_id = gf.id WHERE gf.game_id = ? AND d.temp_path IS NOT NULL',
    ),
    media: col('SELECT local_path AS p FROM media_assets WHERE game_id = ? AND local_path IS NOT NULL'),
  };
}

/** Deletes a game; FK ON DELETE CASCADE removes game_files, cache_entries, downloads,
 *  media_assets, saves, play_sessions and metadata. Disk files are the caller's job. */
export function deleteGame(gameId: number): void {
  getDb().prepare('DELETE FROM games WHERE id = ?').run(gameId);
}
