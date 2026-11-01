import type { RecompManifest } from '@shared/contracts/recomps';
import { getArtRows, upsertArt } from '../db/repositories/recompsRepo';
import { igdbProvider } from '../catalog/igdbProvider';
import { igdbPost } from '../catalog/igdbClient';
import { cacheIgdbImage } from '../catalog/imageCache';
import { hasCredentials } from '../catalog/credentials';
import { boxFrontAssetUrl } from '../launchbox/enrich';
import { getManifest } from './registry';

/**
 * The ORIGINAL game's art for each port (cover + hero backdrop), fetched in main and cached
 * in recomp_art as asset:// URLs - the renderer never sees a remote image URL. Never throws:
 * a port with no art renders the text fallback.
 *
 * Two weights, because the grid asks for ~100 ports at once:
 *  - covers only (the grid): every IGDB cover in one batched `games` query, then just those
 *    images - not the full game details, which also download screenshots and artworks.
 *  - with hero (one port's page): the full IGDB details, for its key art.
 * Ports without an igdbId, or with no IGDB cover, fall back to the LaunchBox box front.
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

function igdbReady(): boolean {
  const c = hasCredentials();
  return c.hasClientId && c.hasClientSecret;
}

/** igdbId -> cover image id, for many games in one request. */
async function coverImageIds(igdbIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (igdbIds.length === 0 || !igdbReady()) return out;
  try {
    const rows = await igdbPost<{ id: number; cover?: { image_id?: string } }[]>(
      'games',
      `fields id,cover.image_id; where id = (${igdbIds.join(',')}); limit ${igdbIds.length};`,
    );
    for (const r of rows) if (r.cover?.image_id) out.set(r.id, r.cover.image_id);
  } catch {
    /* IGDB unreachable - the LaunchBox fallback still runs */
  }
  return out;
}

async function launchboxCover(m: RecompManifest): Promise<string | null> {
  return boxFrontAssetUrl(m.originalTitle, m.gameFile.systemSlug).catch(() => null);
}

/** Art for the given port ids (unknown ids are skipped). `hero` also fetches key art. */
export async function getArt(ids: string[], opts: { hero?: boolean } = {}): Promise<Record<string, PortArt>> {
  const out: Record<string, PortArt> = {};
  const known = [...new Set(ids)].filter((id) => getManifest(id));
  const cached = getArtRows(known);
  const now = Date.now();
  const misses: RecompManifest[] = [];
  for (const id of known) {
    const row = cached.get(id);
    const m = getManifest(id)!;
    const fresh = row && now - row.checked_at < (row.cover_path ? FOUND_TTL_MS : MISS_TTL_MS);
    // A cover fetched for the grid has no hero yet; a port's page fills it in once.
    const needsHero = opts.hero && row && row.cover_path && !row.hero_path && m.igdbId != null && igdbReady();
    if (fresh && !needsHero) out[id] = { coverUrl: row.cover_path, heroUrl: row.hero_path };
    else misses.push(m);
  }
  if (misses.length === 0) return out;

  if (opts.hero) {
    await mapPool(misses, CONCURRENCY, async (m) => {
      let art: PortArt = { coverUrl: null, heroUrl: null };
      if (m.igdbId != null && igdbReady()) {
        const d = await igdbProvider.getGameDetails(m.igdbId).catch(() => null);
        if (d?.coverUrl) art = { coverUrl: d.coverUrl, heroUrl: d.artworks[0] ?? d.screenshots[0] ?? null };
      }
      if (!art.coverUrl) art.coverUrl = await launchboxCover(m);
      upsertArt(m.id, art.coverUrl, art.heroUrl);
      out[m.id] = art;
    });
    return out;
  }

  const covers = await coverImageIds(misses.flatMap((m) => (m.igdbId != null ? [m.igdbId] : [])));
  await mapPool(misses, CONCURRENCY, async (m) => {
    const imageId = m.igdbId != null ? covers.get(m.igdbId) : undefined;
    let cover: string | null = null;
    if (imageId) cover = await cacheIgdbImage(imageId, 't_cover_big_2x').catch(() => null);
    if (!cover) cover = await launchboxCover(m);
    const hero = cached.get(m.id)?.hero_path ?? null; // keep a hero a port's page already found
    upsertArt(m.id, cover, hero);
    out[m.id] = { coverUrl: cover, heroUrl: hero };
  });
  return out;
}
