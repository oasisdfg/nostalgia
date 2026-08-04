import { extname } from 'node:path';
import { getStorageProvider } from './index';
import { getSystem } from '../db/repositories/systemsRepo';
import { upsertIngestedFile, listOwnedStorageKeys } from '../db/repositories/gameFilesRepo';
import type { HashRef, HashAlgo } from '@shared/contracts/storage';
import type { HashSource } from '@shared/contracts/ipc';

function titleFromKey(key: string): string {
  const base = key.split('/').pop() ?? key;
  const ext = extname(base);
  const title = ext ? base.slice(0, -ext.length) : base;
  return title.length > 0 ? title : base;
}

function pickHash(hashes: HashRef[], algo: HashAlgo): string | null {
  return hashes.find((h) => h.algo === algo)?.value ?? null;
}

/**
 * The on-demand catalog's only acquisition path: turns StorageProvider.list()/stat()
 * into games + game_files rows (cache_state='remote'), seeding manifest hashes when
 * available. Idempotent (upsert by opaque storage_key).
 */
export async function scanLibrary(systemId: number, prefix?: string): Promise<{ added: number; updated: number }> {
  const provider = getStorageProvider();
  if (!provider) throw new Error('Storage is not configured. Set the storage folder in Settings.');
  const system = getSystem(systemId);
  if (!system) throw new Error('System not found.');

  const caps = provider.getCapabilities();
  const entries = await provider.list(prefix);
  // Files we already OWN via a catalog download now live in the per-console games folder
  // UNDER the storage root, so a local scan would re-list them; skip by filename so they
  // aren't duplicated as separate 'local' games.
  const ownedNames = new Set(listOwnedStorageKeys(systemId).map((k) => k.split('/').pop()));
  let added = 0;
  let updated = 0;

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (ownedNames.has(entry.key.split('/').pop())) continue;
    let crc32: string | null = null;
    let md5: string | null = null;
    let sha1: string | null = null;
    let sizeBytes = entry.sizeBytes;
    let hashSource: HashSource = 'none';

    if (caps.supportsHashManifest) {
      try {
        const st = await provider.stat(entry.key);
        sizeBytes = st.sizeBytes ?? sizeBytes;
        if (st.hashes.length > 0) {
          crc32 = pickHash(st.hashes, 'crc32');
          md5 = pickHash(st.hashes, 'md5');
          sha1 = pickHash(st.hashes, 'sha1');
          hashSource = 'manifest';
        }
      } catch {
        /* stat is best-effort; fall back to no manifest hashes */
      }
    }

    const result = upsertIngestedFile({
      systemId,
      title: titleFromKey(entry.key),
      storageKey: entry.key,
      sizeBytes,
      crc32,
      md5,
      sha1,
      hashSource,
    });
    if (result === 'added') added++;
    else updated++;
  }

  return { added, updated };
}
