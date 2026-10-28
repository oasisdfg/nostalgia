import { app, net } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getSetting } from '../db/repositories/settingsRepo';
import { sanitizeRemote, setRemoteManifests } from './registry';

/**
 * The remote port registry: `registry/recomps.json` on main of the app's own repo (the same
 * owner/repo as the auto-update feed, baked from electron-builder.yml). Lets ports be added
 * or fixed without an app release. Cached to <userData>/recomps-registry.json so it applies
 * offline; refreshed at most every 6 h at startup and whenever the user checks for updates.
 * Validated entry by entry, and it can never introduce a build-from-source port.
 */

const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function registryUrl(): string | null {
  if (!__UPDATE_OWNER__ || !__UPDATE_REPO__) return null;
  return `https://raw.githubusercontent.com/${__UPDATE_OWNER__}/${__UPDATE_REPO__}/main/registry/recomps.json`;
}

interface Cache {
  etag: string | null;
  fetchedAt: number;
  entries: unknown;
}

function cachePath(): string {
  return join(app.getPath('userData'), 'recomps-registry.json');
}

async function readCache(): Promise<Cache | null> {
  try {
    return JSON.parse(await readFile(cachePath(), 'utf8')) as Cache;
  } catch {
    return null;
  }
}

/** Applies the last fetched list (call once at startup, before anything reads the registry). */
export async function loadCachedRegistry(): Promise<void> {
  const cache = await readCache();
  if (cache) setRemoteManifests(sanitizeRemote(cache.entries));
}

/**
 * Fetches the remote list (conditional request). Failures keep the cached list. With
 * `force` false it skips when the cache is fresh or recomps.autoCheck is off.
 */
export async function refreshRegistry(force = false): Promise<void> {
  const url = registryUrl();
  if (!url) return;
  const cache = await readCache();
  if (!force) {
    const auto = getSetting('recomps.autoCheck');
    if (auto && auto.value === false) return;
    if (cache && Date.now() - cache.fetchedAt < REFRESH_INTERVAL_MS) return;
  }
  try {
    const headers: Record<string, string> = { 'User-Agent': 'Nostalgia' };
    if (cache?.etag) headers['If-None-Match'] = cache.etag;
    const res = await net.fetch(url, { headers });
    if (res.status === 304 && cache) {
      await writeFile(cachePath(), JSON.stringify({ ...cache, fetchedAt: Date.now() }));
      return;
    }
    if (!res.ok) return; // 404 before the file exists, rate limits, outages: keep what we have
    const entries = (await res.json()) as unknown;
    setRemoteManifests(sanitizeRemote(entries));
    await writeFile(cachePath(), JSON.stringify({ etag: res.headers.get('etag'), fetchedAt: Date.now(), entries }));
  } catch {
    /* offline or malformed JSON - the cached list stays in effect */
  }
}
