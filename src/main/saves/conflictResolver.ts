import { basename } from 'node:path';
import { broadcastEvent } from '../ipc/registry';
import { getSaveSyncProvider } from './index';
import { getGame } from '../db/repositories/gamesRepo';
import { getSystem } from '../db/repositories/systemsRepo';
import { getPrimaryFileForGame } from '../db/repositories/gameFilesRepo';
import * as savesRepo from '../db/repositories/savesRepo';
import { hashFile } from '../storage/hashing';
import type { GameRef } from '@shared/contracts/saveSync';

/** Resolves a conflicted save by overwriting one side. Never silent data loss - the user chose. */
export async function resolveConflict(saveId: number, keep: 'local' | 'remote'): Promise<void> {
  const provider = getSaveSyncProvider();
  const save = savesRepo.getSaveInternal(saveId);
  if (!save) return;

  const game = getGame(save.game_id);
  const system = game ? getSystem(game.systemId) : null;
  const file = game ? getPrimaryFileForGame(game.id) : undefined;
  const gameRef: GameRef = {
    gameId: save.game_id,
    systemSlug: system?.slug ?? '',
    primaryStorageKey: file?.storage_key ?? '',
  };

  if (keep === 'local') {
    const h = await hashFile(save.local_path);
    const ref = await provider.uploadSave(save.local_path, {
      gameRef,
      type: save.type,
      slot: save.slot,
      updatedAt: Date.now(),
    });
    savesRepo.applySyncResult(saveId, {
      syncState: 'synced',
      remoteId: ref.remoteId,
      syncedHash: h.sha1,
      remoteUpdatedAt: ref.updatedAt,
      lastSyncedAt: Date.now(),
      sha1: h.sha1,
    });
  } else {
    const remotes = await provider.listSaves(gameRef);
    const remote = remotes.find(
      (r) => (save.remote_id != null && r.remoteId === save.remote_id) || r.key === basename(save.local_path),
    );
    if (remote) {
      await provider.downloadSave(remote, save.local_path);
      const h = await hashFile(save.local_path);
      savesRepo.applySyncResult(saveId, {
        syncState: 'synced',
        remoteId: remote.remoteId,
        syncedHash: h.sha1,
        remoteUpdatedAt: remote.updatedAt,
        lastSyncedAt: Date.now(),
        sha1: h.sha1,
      });
    }
  }
  broadcastEvent('saves:syncStateChanged', { saveId, gameId: save.game_id, syncState: 'synced' });
}
