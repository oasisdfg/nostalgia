import { getDb } from '../connection';
import type { RecompInstallState } from '@shared/contracts/recomps';

/** A recomp_installs row (migration 0009). Paths are opaque and stored verbatim. */
export interface RecompInstallRow {
  recomp_id: string;
  state: RecompInstallState;
  installed_tag: string | null;
  install_dir: string | null;
  exe_path: string | null;
  previous_tag: string | null;
  previous_dir: string | null;
  latest_tag: string | null;
  latest_checked_at: number | null;
  etag: string | null;
  linked_game_id: number | null;
  file_delivered: number;
  last_error: string | null;
  updated_at: number;
}

export type RecompInstallPatch = Partial<Omit<RecompInstallRow, 'recomp_id' | 'updated_at'>>;

export function getInstall(recompId: string): RecompInstallRow | undefined {
  return getDb().prepare('SELECT * FROM recomp_installs WHERE recomp_id = ?').get(recompId) as
    | RecompInstallRow
    | undefined;
}

export function listInstalls(): RecompInstallRow[] {
  return getDb().prepare('SELECT * FROM recomp_installs').all() as RecompInstallRow[];
}

/** Ports linked to a game (the GameDetail Play choice). */
export function listInstallsForGame(gameId: number): RecompInstallRow[] {
  return getDb().prepare('SELECT * FROM recomp_installs WHERE linked_game_id = ?').all(gameId) as RecompInstallRow[];
}

/** Creates the row on first touch, then applies `patch`. Only the given columns change. */
export function upsertInstall(recompId: string, patch: RecompInstallPatch): RecompInstallRow {
  const db = getDb();
  const now = Date.now();
  db.prepare('INSERT INTO recomp_installs (recomp_id, updated_at) VALUES (?, ?) ON CONFLICT(recomp_id) DO NOTHING').run(
    recompId,
    now,
  );
  const keys = Object.keys(patch) as (keyof RecompInstallPatch)[];
  if (keys.length > 0) {
    const sets = keys.map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE recomp_installs SET ${sets}, updated_at = @updated_at WHERE recomp_id = @recomp_id`).run({
      ...patch,
      updated_at: now,
      recomp_id: recompId,
    });
  }
  return getInstall(recompId)!;
}

/** Opens a port play session (emulator_id NULL, recomp_id set). */
export function openRecompSession(input: { gameId: number; gameFileId: number | null; recompId: string }): number {
  const info = getDb()
    .prepare('INSERT INTO play_sessions (game_id, game_file_id, emulator_id, recomp_id, started_at) VALUES (?, ?, NULL, ?, ?)')
    .run(input.gameId, input.gameFileId, input.recompId, Date.now());
  return Number(info.lastInsertRowid);
}

/** Candidate files for auto-link: every file on a system, with its on-disk path when cached. */
export function listCandidateFiles(systemSlug: string): {
  id: number;
  game_id: number;
  size_bytes: number | null;
  crc32: string | null;
  md5: string | null;
  sha1: string | null;
  local_path: string | null;
}[] {
  return getDb()
    .prepare(
      `SELECT gf.id, gf.game_id, gf.size_bytes, gf.crc32, gf.md5, gf.sha1,
              CASE WHEN gf.cache_state = 'cached' THEN ce.local_path END AS local_path
         FROM game_files gf
         JOIN games g ON g.id = gf.game_id
         JOIN systems s ON s.id = g.system_id
         LEFT JOIN cache_entries ce ON ce.game_file_id = gf.id
        WHERE s.slug = ?`,
    )
    .all(systemSlug) as ReturnType<typeof listCandidateFiles>;
}
