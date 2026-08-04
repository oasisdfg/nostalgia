import { getDb } from '../connection';
import { mapDownload, toAssetUrl, type DownloadRow } from './types';
import type { DownloadDTO, DownloadItemDTO, DownloadState } from '@shared/contracts/ipc';
import type { HashAlgo } from '@shared/contracts/storage';

const COLS =
  'id, game_file_id, state, bytes_total, bytes_received, resume_offset, checksum_expected, checksum_algo, error, priority, created_at, updated_at';

export interface DownloadInternal extends DownloadRow {
  temp_path: string | null;
  etag: string | null;
  last_modified: string | null;
}

const INTERNAL_COLS = `${COLS}, temp_path, etag, last_modified`;

export function listDownloads(state?: DownloadState): DownloadDTO[] {
  const db = getDb();
  const rows = state
    ? db.prepare(`SELECT ${COLS} FROM downloads WHERE state = ? ORDER BY priority DESC, created_at`).all(state)
    : db.prepare(`SELECT ${COLS} FROM downloads ORDER BY priority DESC, created_at`).all();
  return (rows as DownloadRow[]).map(mapDownload);
}

interface DownloadItemRow {
  id: number;
  gameFileId: number;
  gameId: number;
  title: string;
  systemId: number;
  systemSlug: string;
  systemName: string;
  state: DownloadState;
  bytesTotal: number | null;
  bytesReceived: number;
  sizeBytes: number | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  coverPath: string | null;
}

/**
 * Downloads joined with their game/system context (and a cover, if any) for the
 * Downloads manager. Active states are ordered first; canceled rows are omitted
 * (a cancel dismisses the entry).
 */
export function listDownloadItems(): DownloadItemDTO[] {
  const rows = getDb()
    .prepare(
      `SELECT d.id AS id, d.game_file_id AS gameFileId, gf.game_id AS gameId, g.title AS title,
              g.system_id AS systemId, s.slug AS systemSlug, s.name AS systemName,
              d.state AS state, d.bytes_total AS bytesTotal, d.bytes_received AS bytesReceived,
              gf.size_bytes AS sizeBytes, d.error AS error, d.created_at AS createdAt, d.updated_at AS updatedAt,
              (SELECT ma.local_path FROM media_assets ma
                 WHERE ma.game_id = gf.game_id AND ma.type = 'box2d' ORDER BY ma.id LIMIT 1) AS coverPath
         FROM downloads d
         JOIN game_files gf ON gf.id = d.game_file_id
         JOIN games g ON g.id = gf.game_id
         JOIN systems s ON s.id = g.system_id
         WHERE d.state != 'canceled'
         ORDER BY CASE d.state
                    WHEN 'downloading' THEN 0 WHEN 'verifying' THEN 1 WHEN 'queued' THEN 2
                    WHEN 'paused' THEN 3 WHEN 'failed' THEN 4 WHEN 'completed' THEN 5 ELSE 6
                  END,
                  d.created_at DESC`,
    )
    .all() as DownloadItemRow[];
  return rows.map((r) => ({
    id: r.id,
    gameFileId: r.gameFileId,
    gameId: r.gameId,
    title: r.title,
    systemId: r.systemId,
    systemSlug: r.systemSlug,
    systemName: r.systemName,
    state: r.state,
    bytesTotal: r.bytesTotal,
    bytesReceived: r.bytesReceived,
    sizeBytes: r.sizeBytes,
    coverUrl: r.coverPath ? toAssetUrl(r.coverPath) : null,
    error: r.error,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export function getDownload(id: number): DownloadDTO | null {
  const r = getDb().prepare(`SELECT ${COLS} FROM downloads WHERE id = ?`).get(id) as DownloadRow | undefined;
  return r ? mapDownload(r) : null;
}

export function getDownloadInternal(id: number): DownloadInternal | undefined {
  return getDb().prepare(`SELECT ${INTERNAL_COLS} FROM downloads WHERE id = ?`).get(id) as DownloadInternal | undefined;
}

export function getActiveDownloadForFile(gameFileId: number): DownloadInternal | undefined {
  return getDb()
    .prepare(
      `SELECT ${INTERNAL_COLS} FROM downloads WHERE game_file_id = ? AND state IN ('queued','downloading','paused','verifying')`,
    )
    .get(gameFileId) as DownloadInternal | undefined;
}

export function nextQueued(): DownloadInternal | undefined {
  return getDb()
    .prepare(`SELECT ${INTERNAL_COLS} FROM downloads WHERE state = 'queued' ORDER BY priority DESC, created_at LIMIT 1`)
    .get() as DownloadInternal | undefined;
}

/** Internal rows in any of the given states (used by startup reconciliation). */
export function listInternalByStates(states: DownloadState[]): DownloadInternal[] {
  if (states.length === 0) return [];
  const placeholders = states.map(() => '?').join(',');
  return getDb()
    .prepare(`SELECT ${INTERNAL_COLS} FROM downloads WHERE state IN (${placeholders})`)
    .all(...states) as DownloadInternal[];
}

export function countByState(...states: DownloadState[]): number {
  if (states.length === 0) return 0;
  const placeholders = states.map(() => '?').join(',');
  return (
    getDb().prepare(`SELECT COUNT(*) AS c FROM downloads WHERE state IN (${placeholders})`).get(...states) as {
      c: number;
    }
  ).c;
}

/** Creates a queued download. Enforces the checksum both-or-neither coupling. */
export function createDownload(
  gameFileId: number,
  priority: number,
  expected: { algo: HashAlgo; value: string } | null,
): DownloadDTO {
  const now = Date.now();
  const tempExpected = expected?.value ?? null;
  const tempAlgo = expected?.algo ?? null;
  const info = getDb()
    .prepare(
      `INSERT INTO downloads (game_file_id, state, bytes_received, resume_offset, checksum_expected, checksum_algo, priority, created_at, updated_at)
       VALUES (?, 'queued', 0, 0, ?, ?, ?, ?, ?)`,
    )
    .run(gameFileId, tempExpected, tempAlgo, priority, now, now);
  return getDownload(Number(info.lastInsertRowid))!;
}

export interface DownloadPatch {
  state?: DownloadState;
  bytesTotal?: number | null;
  bytesReceived?: number;
  resumeOffset?: number;
  etag?: string | null;
  lastModified?: string | null;
  tempPath?: string | null;
  error?: string | null;
}

const PATCH_COLUMN: Record<keyof DownloadPatch, string> = {
  state: 'state',
  bytesTotal: 'bytes_total',
  bytesReceived: 'bytes_received',
  resumeOffset: 'resume_offset',
  etag: 'etag',
  lastModified: 'last_modified',
  tempPath: 'temp_path',
  error: 'error',
};

export function updateDownload(id: number, patch: DownloadPatch): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  (Object.keys(patch) as (keyof DownloadPatch)[]).forEach((k) => {
    if (patch[k] !== undefined) {
      sets.push(`${PATCH_COLUMN[k]} = ?`);
      params.push(patch[k]);
    }
  });
  sets.push('updated_at = ?');
  params.push(Date.now(), id);
  getDb().prepare(`UPDATE downloads SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}
