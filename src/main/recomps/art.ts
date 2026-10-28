import type { RecompManifest } from '@shared/contracts/recomps';
import { getArtRows, upsertArt } from '../db/repositories/recompsRepo';
import { igdbProvider } from '../catalog/igdbProvider';
import { hasCredentials } from '../catalog/credentials';
import { boxFrontAssetUrl } from '../launchbox/enrich';
import { getManifest } from './registry';

/**
 * The ORIGINAL game's art for each port (cover + hero backdrop), fetched in main and cached
 * in recomp_art as asset:// URLs - the renderer never sees a remote image URL. IGDB first
 * (when the port names an igdbId and IGDB is configured, reusing its detail + image caches),
 * else the LaunchBox box front with no hero. Never throws: a port with no art renders the
 * text fallback.
 */

export interface PortArt {
  coverUrl: string | null;
  heroUrl: string | null;
}

const FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// A miss is retried sooner: IGDB may be set up, or the LaunchBox DB imported, later.
const MISS_TTL_MS = 24 * 60 * 60 * 1000;
const CONCURRENCY = 4;

async function mapPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

async function fetchArt(m: RecompManifest): Promise<PortArt> {
  const creds = hasCredentials();
  if (m.igdbId != null && creds.hasClientId && creds.hasClientSecret) {
    const detail = await igdbProvider.getGameDetails(m.igdbId).catch(() => null);
    if (detail?.coverUrl) {
      return { coverUrl: detail.coverUrl, heroUrl: detail.artworks[0] ?? detail.screenshots[0] ?? null };
    }
  }
  const cover = await boxFrontAssetUrl(m.originalTitle, m.gameFile.systemSlug).catch(() => null);
  return { coverUrl: cover, heroUrl: null };
}

/** Art for the given port ids (unknown ids are skipped). */
export async function getArt(ids: string[]): Promise<Record<string, PortArt>> {
  const out: Record<string, PortArt> = {};
  const known = [...new Set(ids)].filter((id) => getManifest(id));
  const cached = getArtRows(known);
  const now = Date.now();
  const misses: RecompManifest[] = [];
  for (const id of known) {
    const row = cached.get(id);
    const fresh = row && now - row.checked_at < (row.cover_path ? FOUND_TTL_MS : MISS_TTL_MS);
    if (fresh) out[id] = { coverUrl: row.cover_path, heroUrl: row.hero_path };
    else misses.push(getManifest(id)!);
  }
  await mapPool(misses, CONCURRENCY, async (m) => {
    try {
      const art = await fetchArt(m);
      upsertArt(m.id, art.coverUrl, art.heroUrl);
      out[m.id] = art;
    } catch {
      out[m.id] = { coverUrl: null, heroUrl: null };
    }
  });
  return out;
}
