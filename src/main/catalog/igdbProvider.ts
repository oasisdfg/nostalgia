import type {
  CatalogProvider,
  CatalogListItem,
  CatalogGameDetail,
  CatalogConnectionResult,
} from '@shared/contracts/catalog';
import { igdbPost, buildGamesQuery, buildGameByIdQuery, getToken } from './igdbClient';
import { getCached, setCached } from '../db/repositories/igdbCacheRepo';
import { cacheIgdbImage } from './imageCache';
import { PLATFORM_LAUNCH, rivalConsolesOf } from './platformMeta';

const PAGE_SIZE = 48;
const LIST_TTL = 7 * 24 * 60 * 60 * 1000;
const DETAIL_TTL = 30 * 24 * 60 * 60 * 1000;
const MAX_SCREENSHOTS = 6;
const MAX_ARTWORKS = 3;
// Bump when the query/filters change so stale cached results are not served.
const CACHE_VERSION = 6;

interface RawGame {
  id: number;
  name: string;
  summary?: string;
  first_release_date?: number;
  genres?: { name: string }[];
  involved_companies?: { company?: { name?: string } }[];
  cover?: { image_id?: string };
  screenshots?: { image_id?: string }[];
  artworks?: { image_id?: string; width?: number; height?: number }[];
  game_modes?: { name: string }[];
  multiplayer_modes?: { onlinemax?: number; offlinemax?: number }[];
  platforms?: number[];
}

/** Runs async jobs with a small concurrency cap (keeps image fetches polite). */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function safeCover(
  imageId: string | undefined,
  // Grid thumbnails default to the retina cover size (528×748) so covers stay crisp
  // on high-DPI displays / at Windows scaling instead of upscaling a 264px t_cover_big.
  size: 't_cover_big_2x' | 't_720p' = 't_cover_big_2x',
): Promise<string | null> {
  if (!imageId) return null;
  try {
    return await cacheIgdbImage(imageId, size);
  } catch {
    return null;
  }
}

function playersLabel(g: RawGame): string | null {
  const mp = g.multiplayer_modes?.[0];
  const max = Math.max(mp?.offlinemax ?? 0, mp?.onlinemax ?? 0);
  if (max > 1) return `Up to ${max} players`;
  if (g.game_modes?.some((m) => /single/i.test(m.name))) return 'Single-player';
  return null;
}

export const igdbProvider: CatalogProvider = {
  async listByPlatform(platformId, opts) {
    const page = opts.page ?? 0;
    const search = opts.search?.trim() ?? '';
    const sort = opts.sort ?? 'popular';
    const key = `list:v${CACHE_VERSION}:${platformId}:${search}:${sort}:${opts.genreId ?? ''}:${opts.themeId ?? ''}:${page}`;
    let raw = getCached<RawGame[]>(key, LIST_TTL);
    if (!raw) {
      raw = await igdbPost<RawGame[]>(
        'games',
        buildGamesQuery({
          platformId,
          search,
          limit: PAGE_SIZE + 1,
          offset: page * PAGE_SIZE,
          sort,
          // Browsing shows games native to this console (ports of older games drop
          // out - they live in their original console's section; search still finds
          // them here). Exclusives additionally require no rival-console release.
          nativeAfter: PLATFORM_LAUNCH[platformId],
          excludePlatforms: sort === 'exclusives' ? rivalConsolesOf(platformId) : undefined,
          genreId: opts.genreId,
          themeId: opts.themeId,
        }),
      );
      setCached(key, raw);
    }
    const hasMore = raw.length > PAGE_SIZE;
    const slice = raw.slice(0, PAGE_SIZE);
    const items: CatalogListItem[] = await mapPool(slice, 6, async (g) => ({
      igdbId: g.id,
      name: g.name,
      coverUrl: await safeCover(g.cover?.image_id),
      releaseYear: g.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null,
    }));
    return { items, hasMore };
  },

  async getGameDetails(igdbId) {
    const key = `game:v${CACHE_VERSION}:${igdbId}`;
    let raw = getCached<RawGame | null>(key, DETAIL_TTL);
    if (raw === null) {
      const arr = await igdbPost<RawGame[]>('games', buildGameByIdQuery(igdbId));
      raw = arr[0] ?? null;
      setCached(key, raw);
    }
    if (!raw) return null;

    const screenshotIds = (raw.screenshots ?? [])
      .map((s) => s.image_id)
      .filter((x): x is string => !!x)
      .slice(0, MAX_SCREENSHOTS);
    const screenshots = (
      await mapPool(screenshotIds, 6, async (id) => {
        try {
          return await cacheIgdbImage(id, 't_720p');
        } catch {
          return null;
        }
      })
    ).filter((x): x is string => !!x);

    // High-res key artwork for the detail hero (1080p). IGDB artworks vary wildly in
    // native size - some are tiny logo images that upscale into a pixelated mess when
    // stretched full-window - so order by real resolution (largest first) and drop
    // anything below backdrop size; the UI falls back to a screenshot when none qualify.
    const artworkIds = (raw.artworks ?? [])
      .filter((a): a is { image_id: string; width?: number; height?: number } => !!a.image_id)
      .filter((a) => (a.width ?? 0) >= 1200 && (a.height ?? 0) >= 600)
      .sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))
      .map((a) => a.image_id)
      .slice(0, MAX_ARTWORKS);
    const artworks = (
      await mapPool(artworkIds, 3, async (id) => {
        try {
          return await cacheIgdbImage(id, 't_1080p');
        } catch {
          return null;
        }
      })
    ).filter((x): x is string => !!x);

    const detail: CatalogGameDetail = {
      igdbId: raw.id,
      name: raw.name,
      summary: raw.summary ?? null,
      releaseDate: raw.first_release_date
        ? new Date(raw.first_release_date * 1000).toISOString().slice(0, 10)
        : null,
      genres: (raw.genres ?? []).map((x) => x.name).filter(Boolean),
      companies: (raw.involved_companies ?? [])
        .map((c) => c.company?.name)
        .filter((x): x is string => !!x),
      gameModes: (raw.game_modes ?? []).map((x) => x.name).filter(Boolean),
      players: playersLabel(raw),
      // The detail view (and the library pop-out) shows the cover LARGE, so cache it at
      // full 720p rather than the retina cover thumbnail (t_cover_big_2x) used for the grid.
      coverUrl: await safeCover(raw.cover?.image_id, 't_720p'),
      screenshots,
      artworks,
      platformId: raw.platforms?.[0] ?? 0,
    };
    return detail;
  },

  async testConnection(): Promise<CatalogConnectionResult> {
    try {
      await getToken(true);
      await igdbPost<unknown[]>('games', 'fields id; limit 1;');
      return { ok: true, message: 'Connected to IGDB.' };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : 'Connection failed.' };
    }
  },
};
