import { getSetting } from '../db/repositories/settingsRepo';
import { LocalFolderStorageProvider } from './providers/localFolder';
import type { StorageProvider } from '@shared/contracts/storage';

function settingString(key: string): string | null {
  const row = getSetting(key);
  const value = row && !row.encrypted ? row.value : null;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Resolves the active StorageProvider from settings. Only the local-folder
 * provider ships now; storage.providerId is reserved for future backends.
 * Returns null when storage.root is not configured.
 */
export function getStorageProvider(): StorageProvider | null {
  const root = settingString('storage.root');
  if (!root) return null;
  return new LocalFolderStorageProvider(root);
}
