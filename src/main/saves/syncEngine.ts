import { basename } from 'node:path';
import { broadcastEvent } from '../ipc/registry';
import { getDb } from '../db/connection';
import { getSaveSyncProvider } from './index';
import { getGame } from '../db/repositories/gamesRepo';
import { getSystem } from '../db/repositories/systemsRepo';
import { getPrimaryFileForGame } from '../db/repositories/gameFilesRepo';
import * as savesRepo from '../db/repositories/savesRepo';
import { hashFile } from '../storage/hashing';
import type { GameRef, RemoteSave } from '@shared/contracts/saveSync';
import type { SyncState } from '@shared/contracts/ipc';

async function currentHash(localPath: string, fallback: string | null): Promise<string | null> {
  try {
    return (await hashFile(localPath)).sha1;
  } catch {
    return fallback;
  }
}

function matchRemote(remotes: RemoteSave[], save: savesRepo.SaveInternal): RemoteSave | undefined {
  return remotes.find(
    (r) => (save.remote_id != null && r.remoteId === save.remote_id) || r.key === basename(save.local_path),
  );
}

/**
 * Three-way sync for one game's saves. conflict := local sha1 changed AND remote
 * updatedAt changed since last sync. Otherwise upload/download the side that
 * changed. Uses the active SaveSyncProvider (local-folder now).
 */
export async function syncGame(gameId: number): Promise<void> {
  const provider = getSaveSyncProvider();
  const game = getGame(gameId);
  if (!game) return;

  const system = getSystem(game.systemId);
  const file = getPrimaryFileForGame(gameId);
  const gameRef: GameRef = {
    gameId,
    systemSlug: system?.slug ?? '',
    primaryStorageKey: file?.storage_key ?? '',
  };

  let remotes: RemoteSave[] = [];
  try {
    remotes = await provider.listSaves(gameRef);
  } catch {
    remotes = [];
  }

  for (const save of savesRepo.getSaveRowsForGame(gameId)) {
    try {
      broadcastEvent('saves:syncProgress', { saveId: save.id, gameId, fraction: 0 });
      const local = await currentHash(save.local_path, save.sha1);
      const remote = matchRemote(remotes, save);
      const localChanged = local !== save.synced_hash;
      const remoteChanged = remote ? remote.updatedAt !== save.remote_updated_at : save.remote_updated_at != null;

      let next: SyncState;
      if (remote && localChanged && remoteChanged) {
        next = 'conflict';
        savesRepo.setSyncState(save.id, next);
      } else if (localChanged) {
        const ref = await provider.uploadSave(save.local_path, {
          gameRef,
          type: save.type,
          slot: save.slot,
          updatedAt: Date.now(),
        });
        savesRepo.applySyncResult(save.id, {
          syncState: 'synced',
          remoteId: ref.remoteId,
          syncedHash: local,
          remoteUpdatedAt: ref.updatedAt,
          lastSyncedAt: Date.now(),
          sha1: local,
        });
        next = 'synced';
      } else if (remoteChanged && remote) {
        await provider.downloadSave(remote, save.local_path);
        const h = await hashFile(save.local_path);
        savesRepo.applySyncResult(save.id, {
          syncState: 'synced',
          remoteId: remote.remoteId,
          syncedHash: h.sha1,
          remoteUpdatedAt: remote.updatedAt,
          lastSyncedAt: Date.now(),
          sha1: h.sha1,
        });
        next = 'synced';
      } else {
        next = 'synced';
        savesRepo.setSyncState(save.id, next);
      }
      broadcastEvent('saves:syncStateChanged', { saveId: save.id, gameId, syncState: next });
    } catch {
      /* leave this save's state unchanged on error */
    }
  }
}

export async function syncAll(): Promise<void> {
  const rows = getDb().prepare('SELECT DISTINCT game_id FROM saves').all() as { game_id: number }[];
  for (const r of rows) await syncGame(r.game_id);
}
