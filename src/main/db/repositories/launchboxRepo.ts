import { getDb } from '../connection';

export interface LbGameRow {
  database_id: number;
  title: string;
  title_norm: string;
  platform: string;
  overview: string | null;
  release_date: string | null;
  genres: string | null;
  developer: string | null;
  publisher: string | null;
  community_rating: number | null;
  community_rating_count: number | null;
  esrb: string | null;
  max_players: number | null;
  cooperative: number;
  video_url: string | null;
  wikipedia_url: string | null;
}
export interface LbImageRow {
  database_id: number;
  type: string;
  file_name: string;
  region: string | null;
}
export interface LbAltRow {
  database_id: number;
  name_norm: string;
}

/** Wipe every LaunchBox table (a full-refresh import replaces the whole dataset). */
export function clearAll(): void {
  const db = getDb();
  db.exec(
    'DELETE FROM launchbox_images; DELETE FROM launchbox_alt_names; DELETE FROM launchbox_games; DELETE FROM launchbox_meta;',
  );
}

export function insertGames(rows: LbGameRow[]): void {
  if (rows.length === 0) return;
  const stmt = getDb().prepare(
    `INSERT OR REPLACE INTO launchbox_games
       (database_id, title, title_norm, platform, overview, release_date, genres, developer, publisher,
        community_rating, community_rating_count, esrb, max_players, cooperative, video_url, wikipedia_url)
     VALUES (@database_id, @title, @title_norm, @platform, @overview, @release_date, @genres, @developer, @publisher,
        @community_rating, @community_rating_count, @esrb, @max_players, @cooperative, @video_url, @wikipedia_url)`,
  );
  getDb().transaction((batch: LbGameRow[]) => {
    for (const r of batch) stmt.run(r);
  })(rows);
}

export function insertAltNames(rows: LbAltRow[]): void {
  if (rows.length === 0) return;
  const stmt = getDb().prepare('INSERT INTO launchbox_alt_names (database_id, name_norm) VALUES (@database_id, @name_norm)');
  getDb().transaction((batch: LbAltRow[]) => {
    for (const r of batch) stmt.run(r);
  })(rows);
}

export function insertImages(rows: LbImageRow[]): void {
  if (rows.length === 0) return;
  const stmt = getDb().prepare(
    'INSERT INTO launchbox_images (database_id, type, file_name, region) VALUES (@database_id, @type, @file_name, @region)',
  );
  getDb().transaction((batch: LbImageRow[]) => {
    for (const r of batch) stmt.run(r);
  })(rows);
}

export function setMeta(gameCount: number): void {
  getDb()
    .prepare(
      `INSERT INTO launchbox_meta (id, imported_at, game_count) VALUES (1, @now, @count)
       ON CONFLICT(id) DO UPDATE SET imported_at = @now, game_count = @count`,
    )
    .run({ now: Date.now(), count: gameCount });
}

export function getStatus(): { importedAt: number | null; gameCount: number } {
  const row = getDb().prepare('SELECT imported_at, game_count FROM launchbox_meta WHERE id = 1').get() as
    | { imported_at: number | null; game_count: number }
    | undefined;
  return { importedAt: row?.imported_at ?? null, gameCount: row?.game_count ?? 0 };
}

/** Fetch a LaunchBox game (+ its images) by its database_id - used by the metadata provider
 *  to resolve details/media after a name search returned the id. */
export function getByDatabaseId(databaseId: number): { game: LbGameRow; images: LbImageRow[] } | null {
  const db = getDb();
  const game = db.prepare('SELECT * FROM launchbox_games WHERE database_id = ? LIMIT 1').get(databaseId) as
    | LbGameRow
    | undefined;
  if (!game) return null;
  const images = db.prepare('SELECT * FROM launchbox_images WHERE database_id = ?').all(databaseId) as LbImageRow[];
  return { game, images };
}

/**
 * Finds the LaunchBox game for a normalized title on a platform: exact (title_norm,
 * platform), else via an alternate name on that platform. Returns the game + its images.
 */
export function lookup(titleNorm: string, platform: string): { game: LbGameRow; images: LbImageRow[] } | null {
  const db = getDb();
  let game = db
    .prepare('SELECT * FROM launchbox_games WHERE title_norm = ? AND platform = ? LIMIT 1')
    .get(titleNorm, platform) as LbGameRow | undefined;
  if (!game) {
    game = db
      .prepare(
        `SELECT g.* FROM launchbox_games g
           JOIN launchbox_alt_names a ON a.database_id = g.database_id
          WHERE a.name_norm = ? AND g.platform = ? LIMIT 1`,
      )
      .get(titleNorm, platform) as LbGameRow | undefined;
  }
  if (!game) return null;
  const images = db.prepare('SELECT * FROM launchbox_images WHERE database_id = ?').all(game.database_id) as LbImageRow[];
  return { game, images };
}
