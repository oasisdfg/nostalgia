import { getDb } from '../connection';
import { mapSave, type SaveRow } from './types';
import type { SaveDTO, SaveType, SyncState } from '@shared/contracts/ipc';

const DTO_COLS =
  'id, game_id, system_id, type, slot, local_path, size_bytes, crc32, md5, sha1, sync_state, remote_id, updated_at, last_synced_at';

/** Full internal row including the sync bookkeeping (not surfaced in SaveDTO). */
export interface SaveInternal extends SaveRow {
  remote_updated_at: number | null;
  synced_hash: string | null;
}
const INTERNAL_COLS = `${DTO_COLS}, remote_updated_at, synced_hash`;

export function listSavesForGame(gameId: number): SaveDTO[] {
  return (
    getDb().prepare(`SELECT ${DTO_COLS} FROM saves WHERE game_id = ? ORDER BY type, slot`).all(gameId) as SaveRow[]
  ).map(mapSave);
}

export function getSaveInternal(id: number): SaveInternal | undefined {
  return getDb().prepare(`SELECT ${INTERNAL_COLS} FROM saves WHERE id = ?`).get(id) as SaveInternal | undefined;
}

export function getSaveRowsForGame(gameId: number): SaveInternal[] {
  return getDb()
    .prepare(`SELECT ${INTERNAL_COLS} FROM saves WHERE game_id = ? ORDER BY type, slot`)
    .all(gameId) as SaveInternal[];
}

export interface UpsertSaveInput {
  gameId: number;
  systemId: number;
  type: SaveType;
  slot: number | null;
  localPath: string;
  sizeBytes: number | null;
  crc32: string | null;
  md5: string | null;
  sha1: string | null;
}

/**
 * Idempotent upsert keyed on (game_id, type, local_path) - local_path is the real
 * per-file identity (SQLite treats NULL slots as distinct, so we don't rely on the
 * unique index alone). Returns the row id.
 */
export function upsertSave(input: UpsertSaveInput): number {
  const db = getDb();
  const now = Date.now();
  const existing = db
    .prepare('SELECT id FROM saves WHERE game_id = ? AND type = ? AND local_path = ?')
    .get(input.gameId, input.type, input.localPath) as { id: number } | undefined;
  if (existing) {
    db.prepare(
      'UPDATE saves SET system_id = ?, slot = ?, size_bytes = ?, crc32 = ?, md5 = ?, sha1 = ?, updated_at = ? WHERE id = ?',
    ).run(input.systemId, input.slot, input.sizeBytes, input.crc32, input.md5, input.sha1, now, existing.id);
    return existing.id;
  }
  const info = db
    .prepare(
      `INSERT INTO saves (game_id, system_id, type, slot, local_path, size_bytes, crc32, md5, sha1, sync_state, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'local_only', ?)`,
    )
    .run(
      input.gameId,
      input.systemId,
      input.type,
      input.slot,
      input.localPath,
      input.sizeBytes,
      input.crc32,
      input.md5,
      input.sha1,
      now,
    );
  return Number(info.lastInsertRowid);
}

export function setSyncState(id: number, state: SyncState): void {
  getDb().prepare('UPDATE saves SET sync_state = ?, updated_at = ? WHERE id = ?').run(state, Date.now(), id);
}

export function deleteSaveRow(id: number): void {
  getDb().prepare('DELETE FROM saves WHERE id = ?').run(id);
}

export interface SyncBookkeeping {
  syncState: SyncState;
  remoteId?: string | null;
  syncedHash?: string | null;
  remoteUpdatedAt?: number | null;
  lastSyncedAt?: number | null;
  sha1?: string | null;
}

/** Persists the result of a successful sync (the internal columns the engine needs). */
export function applySyncResult(id: number, b: SyncBookkeeping): void {
  const sets: string[] = ['sync_state = @syncState', 'updated_at = @now'];
  const params: Record<string, unknown> = { id, now: Date.now(), syncState: b.syncState };
  const add = (col: string, key: string, val: unknown): void => {
    if (val !== undefined) {
      sets.push(`${col} = @${key}`);
      params[key] = val;
    }
  };
  add('remote_id', 'remoteId', b.remoteId);
  add('synced_hash', 'syncedHash', b.syncedHash);
  add('remote_updated_at', 'remoteUpdatedAt', b.remoteUpdatedAt);
  add('last_synced_at', 'lastSyncedAt', b.lastSyncedAt);
  add('sha1', 'sha1', b.sha1);
  getDb().prepare(`UPDATE saves SET ${sets.join(', ')} WHERE id = @id`).run(params);
}
