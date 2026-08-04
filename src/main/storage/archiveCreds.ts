// Internet Archive S3-style credential resolution - MAIN PROCESS ONLY.
// Never returned to the renderer, never logged, never crosses IPC.
//
// archive.org gates its `access-restricted-item` collections behind an account.
// The item's PUBLIC metadata (file list, d1/d2 data nodes) is still readable, but a
// download of the actual bytes returns HTTP 401 unless the request carries an
// `Authorization: LOW <accesskey>:<secret>` header - the same low-security S3 keys
// issued at https://archive.org/account/s3.php.
//
// IMPORTANT: the header only works against the DIRECT data-node URL
// (https://iaNNNNNN.us.archive.org/…). The canonical https://archive.org/download/…
// URL 302-redirects to that node, and both fetch() and aria2 drop the Authorization
// header across the cross-origin redirect - so the canonical URL still 401s. The
// provider therefore downloads from d1/d2 directly (see archiveOrg.mirrorUrls).
import { getSetting } from '../db/repositories/settingsRepo';
import { getSecret } from '../secrets/safeStore';

function credFromSettings(key: string): string | null {
  const row = getSetting(key);
  return row && !row.encrypted && typeof row.value === 'string' && row.value.length > 0 ? row.value : null;
}

/** The secret half, decrypted in-process. Never crosses IPC (see the security posture). */
function secretFromSettings(key: string): string | null {
  try {
    const v = getSecret(key);
    return v && v.length > 0 ? v : null;
  } catch {
    return null; // row exists but isn't a valid safeStorage blob - treat as unconfigured
  }
}

/**
 * The `LOW key:secret` credential pair, or null when unconfigured. Settings win over .env.
 *
 * The .env fallback is DEV-ONLY: a packaged build ships no .env, so without the Settings
 * path below an installed app had no way to reach archive.org's `access-restricted-item`
 * collections at all - every Redump set was silently skipped and lookups fell through to
 * the much slower torrent sources.
 */
export function archiveCredential(): { key: string; secret: string } | null {
  const key = credFromSettings('archive.s3Key') ?? process.env.ARCHIVE_S3_KEY ?? null;
  const secret = secretFromSettings('archive.s3Secret') ?? process.env.ARCHIVE_S3_SECRET ?? null;
  return key && secret ? { key, secret } : null;
}

/** Presence flags for the Settings UI - never the values themselves. */
export function archiveCredentialStatus(): { hasKey: boolean; hasSecret: boolean; configured: boolean } {
  const hasKey = !!(credFromSettings('archive.s3Key') ?? process.env.ARCHIVE_S3_KEY);
  const hasSecret = !!(secretFromSettings('archive.s3Secret') ?? process.env.ARCHIVE_S3_SECRET);
  return { hasKey, hasSecret, configured: hasKey && hasSecret };
}

/** The ready-to-send `Authorization` header value, or null when no creds are configured. */
export function archiveAuthHeader(): string | null {
  const c = archiveCredential();
  return c ? `LOW ${c.key}:${c.secret}` : null;
}

/** Whether restricted-item downloads are currently possible. */
export function hasArchiveCredential(): boolean {
  return archiveCredential() != null;
}
