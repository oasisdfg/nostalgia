import { getDb } from '../connection';
import { mapMediaAsset, type MediaAssetRow } from './types';
import type { MediaAssetDTO } from '@shared/contracts/ipc';

const COLS = 'id, game_id, type, local_path, source_url, provider, width, height, checksum, downloaded_at';

export function listMediaForGame(gameId: number): MediaAssetDTO[] {
  return (
    getDb().prepare(`SELECT ${COLS} FROM media_assets WHERE game_id = ? ORDER BY type, id`).all(gameId) as MediaAssetRow[]
  ).map(mapMediaAsset);
}
