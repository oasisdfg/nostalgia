import { app } from 'electron';
import { join } from 'node:path';
import { getSetting } from '../db/repositories/settingsRepo';
import { LocalFolderSaveSyncProvider } from './providers/localFolderSaveSync';
import type { SaveSyncProvider } from '@shared/contracts/saveSync';

function settingString(key: string): string | null {
  const row = getSetting(key);
  const value = row && !row.encrypted ? row.value : null;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Resolves the active SaveSyncProvider. Only the local-folder backend ships now;
 * `saves.syncDir` reserves a future setting. Default root: <storage.root>/.saves
 * (co-located with the library), else <userData>/saves-sync. Always returns a
 * provider (local sync is always available), so callers don't branch on null.
 */
export function getSaveSyncProvider(): SaveSyncProvider {
  const explicit = settingString('saves.syncDir');
  const storageRoot = settingString('storage.root');
  const root = explicit ?? (storageRoot ? join(storageRoot, '.saves') : join(app.getPath('userData'), 'saves-sync'));
  return new LocalFolderSaveSyncProvider(root);
}
