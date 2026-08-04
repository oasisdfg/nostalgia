import { getDb } from '../connection';
import type { MetadataProviderId, MatchedBy, NormalizedMetadata } from '@shared/contracts/metadata';

export interface UpsertMetadataInput {
  gameId: number;
  provider: MetadataProviderId;
  providerGameId: string;
  matchedBy: MatchedBy;
  matchConfidence: number;
  raw: unknown;
}

/** One row per provider per game (UNIQUE game_id, provider). Idempotent upsert. */
export function upsertMetadata(input: UpsertMetadataInput): void {
  getDb()
    .prepare(
      `INSERT INTO metadata (game_id, provider, provider_game_id, raw_json, matched_by, match_confidence, scraped_at)
       VALUES (@gameId, @provider, @providerGameId, @rawJson, @matchedBy, @matchConfidence, @now)
       ON CONFLICT(game_id, provider) DO UPDATE SET
         provider_game_id = excluded.provider_game_id,
         raw_json = excluded.raw_json,
         matched_by = excluded.matched_by,
         match_confidence = excluded.match_confidence,
         scraped_at = excluded.scraped_at`,
    )
    .run({
      gameId: input.gameId,
      provider: input.provider,
      providerGameId: input.providerGameId,
      rawJson: JSON.stringify(input.raw ?? null),
      matchedBy: input.matchedBy,
      matchConfidence: input.matchConfidence,
      now: Date.now(),
    });
}

/**
 * Denormalizes selected fields onto games. Skips locked rows unless force=true
 * (a manual apply explicitly overwrites, then re-pins the lock).
 */
export function denormalizeOntoGame(gameId: number, meta: NormalizedMetadata, force = false): boolean {
  const db = getDb();
  const row = db.prepare('SELECT metadata_locked FROM games WHERE id = ?').get(gameId) as
    | { metadata_locked: number }
    | undefined;
  if (!row) return false;
  if (!force && row.metadata_locked === 1) return false;
  db.prepare(
    `UPDATE games SET description = ?, release_date = ?, genre = ?, players = ?, rating = ?, updated_at = ? WHERE id = ?`,
  ).run(meta.description, meta.releaseDate, meta.genre, meta.players, meta.rating, Date.now(), gameId);
  return true;
}

export function setMetadataLocked(gameId: number, locked: boolean): void {
  getDb()
    .prepare('UPDATE games SET metadata_locked = ?, updated_at = ? WHERE id = ?')
    .run(locked ? 1 : 0, Date.now(), gameId);
}
