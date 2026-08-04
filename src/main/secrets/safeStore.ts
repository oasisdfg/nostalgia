// The ONE module permitted to call Electron safeStorage. Plaintext secrets are
// encrypted at rest; decryption is in-process only and never crosses IPC.
import { safeStorage } from 'electron';
import { getDb } from '../db/connection';

/** Encrypts plaintext to a base64 blob for storage in settings.value. */
export function encryptSecret(plaintext: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage is unavailable; refusing to persist a secret as plaintext');
  }
  return safeStorage.encryptString(plaintext).toString('base64');
}

/** Decrypts a base64 blob produced by encryptSecret. In-process use only. */
export function decryptSecret(base64: string): string {
  return safeStorage.decryptString(Buffer.from(base64, 'base64'));
}

/**
 * Reads and decrypts an encrypted setting value. In-process only - used by
 * MetadataProvider implementations (Phase 6). Returns null if absent or not
 * an encrypted row. NEVER expose the result over IPC.
 */
export function getSecret(key: string): string | null {
  const row = getDb()
    .prepare('SELECT value, encrypted FROM settings WHERE key = ?')
    .get(key) as { value: string | null; encrypted: number } | undefined;
  if (!row || row.encrypted !== 1 || row.value === null) return null;
  return decryptSecret(row.value);
}
