import { getDb } from '../connection';

export function open(input: { gameId: number; gameFileId: number; emulatorId: number }): number {
  const info = getDb()
    .prepare('INSERT INTO play_sessions (game_id, game_file_id, emulator_id, started_at) VALUES (?, ?, ?, ?)')
    .run(input.gameId, input.gameFileId, input.emulatorId, Date.now());
  return Number(info.lastInsertRowid);
}

export function close(id: number, exitCode: number | null): void {
  getDb().prepare('UPDATE play_sessions SET ended_at = ?, exit_code = ? WHERE id = ?').run(Date.now(), exitCode, id);
}

/** Updates the denormalized per-game play stats. Call once per session close. */
export function rollupPlay(gameId: number): void {
  getDb()
    .prepare('UPDATE games SET play_count = play_count + 1, last_played_at = ?, updated_at = ? WHERE id = ?')
    .run(Date.now(), Date.now(), gameId);
}

export interface RecentSession {
  id: number;
  game_id: number;
  started_at: number;
  ended_at: number | null;
}

/** Cross-game recent feed, backed by idx_play_sessions_started (migration 0002). */
export function recentSessions(limit = 20): RecentSession[] {
  return getDb()
    .prepare('SELECT id, game_id, started_at, ended_at FROM play_sessions ORDER BY started_at DESC LIMIT ?')
    .all(limit) as RecentSession[];
}
