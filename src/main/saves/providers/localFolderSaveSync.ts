import { stat as fsStat, readdir, mkdir, copyFile, unlink } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { DownloadOptions, DownloadResult } from '@shared/contracts/storage';
import type {
  SaveSyncProvider,
  SaveSyncCapabilities,
  GameRef,
  RemoteSave,
  SaveUploadMeta,
  RemoteSaveRef,
} from '@shared/contracts/saveSync';

/**
 * Ship-now SaveSyncProvider backed by a local folder (the "saves root"). Each game's
 * saves live under <root>/<systemSlug__gameId>/. Satisfies the full provider-agnostic
 * SaveSyncProvider so a real cloud backend can drop in later (mirrors LocalFolderStorageProvider).
 */
export class LocalFolderSaveSyncProvider implements SaveSyncProvider {
  constructor(private readonly root: string) {}

  getCapabilities(): SaveSyncCapabilities {
    return { providerId: 'local-folder', supportsDelete: true };
  }

  private saveDir(gameRef: GameRef): string {
    return join(this.root, encodeURIComponent(`${gameRef.systemSlug}__${gameRef.gameId}`));
  }

  async listSaves(gameRef: GameRef): Promise<RemoteSave[]> {
    const dir = this.saveDir(gameRef);
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const out: RemoteSave[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const st = await fsStat(join(dir, entry.name));
      out.push({ remoteId: entry.name, key: entry.name, sizeBytes: st.size, updatedAt: Math.floor(st.mtimeMs) });
    }
    return out;
  }

  async uploadSave(localPath: string, meta: SaveUploadMeta): Promise<RemoteSaveRef> {
    const dir = this.saveDir(meta.gameRef);
    await mkdir(dir, { recursive: true });
    const remoteId = basename(localPath);
    const dest = join(dir, remoteId);
    await copyFile(localPath, dest);
    const st = await fsStat(dest);
    return { remoteId, updatedAt: Math.floor(st.mtimeMs) };
  }

  async downloadSave(remoteRef: RemoteSave, destPath: string, opts?: Omit<DownloadOptions, 'destPath'>): Promise<DownloadResult> {
    const found = await this.findSaveFile(remoteRef.remoteId);
    if (!found) return { outcome: 'completed', bytesWritten: 0 };
    if (opts?.signal?.aborted) return { outcome: 'aborted', bytesWritten: 0 };
    await copyFile(found, destPath);
    const st = await fsStat(destPath);
    return { outcome: 'completed', bytesWritten: st.size };
  }

  async deleteSave(remoteRef: RemoteSave): Promise<void> {
    const found = await this.findSaveFile(remoteRef.remoteId);
    if (found) await unlink(found);
  }

  private async findSaveFile(remoteId: string): Promise<string | null> {
    let dirs;
    try {
      dirs = await readdir(this.root, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const candidate = join(this.root, d.name, remoteId);
      try {
        await fsStat(candidate);
        return candidate;
      } catch {
        /* keep looking */
      }
    }
    return null;
  }
}
