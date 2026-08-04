import { getDb } from '../connection';
import { encryptSecret } from '../../secrets/safeStore';
import type { SettingRow } from '@shared/contracts/ipc';

interface RawSettingRow {
  key: string;
  value: string | null;
  encrypted: number;
}

/**
 * Reads a setting. Encrypted rows are REDACTED - value is null and the plaintext
 * is never returned over IPC. Non-encrypted values are parsed from JSON.
 */
export function getSetting(key: string): SettingRow | null {
  const row = getDb()
    .prepare('SELECT key, value, encrypted FROM settings WHERE key = ?')
    .get(key) as RawSettingRow | undefined;
  if (!row) return null;
  if (row.encrypted === 1) return { key: row.key, value: null, encrypted: true };
  return { key: row.key, value: row.value === null ? null : JSON.parse(row.value), encrypted: false };
}

/** Returns a key->value map; encrypted keys map to null (redacted). */
export function getSettings(keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const row = getSetting(key);
    out[key] = row && !row.encrypted ? row.value : null;
  }
  return out;
}

/**
 * Writes a setting. When encrypted is true the value is encrypted at rest via
 * safeStorage (the plaintext is consumed and never persisted in the clear).
 */
export function setSetting(key: string, value: unknown, encrypted = false): void {
  const now = Date.now();
  const stored = encrypted ? encryptSecret(String(value)) : JSON.stringify(value ?? null);
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, encrypted, updated_at)
       VALUES (@key, @value, @encrypted, @now)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, encrypted = excluded.encrypted, updated_at = excluded.updated_at`,
    )
    .run({ key, value: stored, encrypted: encrypted ? 1 : 0, now });
}
