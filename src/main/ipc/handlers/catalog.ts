import { z } from 'zod';
import { registerInvoke } from '../registry';
import { igdbProvider } from '../../catalog/igdbProvider';
import { getSystem } from '../../db/repositories/systemsRepo';
import { upsertArchiveFile, getFileRow, getFileByStorageKey } from '../../db/repositories/gameFilesRepo';
import {
  createCatalogFavorite,
  favoritedIgdbIdsForSystem,
  findBySystemIgdb,
  setFavorite,
} from '../../db/repositories/gamesRepo';
import { removeGameFromLibrary } from '../../storage/downloadManager';
import { registerLocalCover, replaceCover } from '../../metadata/mediaCache';
import { enrichCatalogDetail, boxFrontAssetUrl } from '../../launchbox/enrich';
import { enqueue } from '../../storage/downloadManager';
import { matchAnySourceForSystem, hasAnySourceForSystem } from '../../catalog/sources';
import { IGDB_PLATFORM_BY_SLUG } from '@shared/contracts/catalog';
import type { CatalogListResult, CatalogListItem } from '@shared/contracts/catalog';

const listSchema = z.object({
  systemId: z.number().int(),
  search: z.string().optional(),
  page: z.number().int().min(0).optional(),
  sort: z.enum(['popular', 'releaseDate', 'rating', 'exclusives']).optional(),
  // 'g:<genreId>' or 't:<themeId>' - parsed to ints below, never interpolated raw.
  filter: z
    .string()
    .regex(/^[gt]:\d{1,4}$/)
    .optional(),
});
const gameDetailsSchema = z.object({ igdbId: z.number().int(), systemId: z.number().int().optional() });
const platformGameSchema = z.object({ igdbId: z.number().int(), systemId: z.number().int() });
const setFavoriteSchema = z.object({
  igdbId: z.number().int(),
  systemId: z.number().int(),
  favorite: z.boolean(),
});

/**
 * Registers the best available cover for an owned/favorited game: the LaunchBox retail
 * case front when the title matches (replacing any prior cover), else the IGDB cover.
 * Best-effort - a game is never left art-less because an image fetch failed.
 */
async function applyBestCover(
  gameId: number,
  systemId: number,
  title: string,
  igdbCoverUrl: string | null,
): Promise<void> {
  const slug = getSystem(systemId)?.slug;
  const box = slug ? await boxFrontAssetUrl(title, slug).catch(() => null) : null;
  if (box) await replaceCover(gameId, box);
  else if (igdbCoverUrl) await registerLocalCover(gameId, igdbCoverUrl);
}

/** Marks which items are in My List for the system, so catalog cards show the heart filled. */
function markFavorites(systemId: number, items: CatalogListItem[]): CatalogListItem[] {
  const fav = favoritedIgdbIdsForSystem(
    systemId,
    items.map((i) => i.igdbId),
  );
  return items.map((i) => ({ ...i, favorite: fav.has(i.igdbId) }));
}

export function registerCatalogHandlers(): void {
  registerInvoke('catalog:listByPlatform', async (req): Promise<CatalogListResult> => {
    const p = listSchema.parse(req);
    const page = p.page ?? 0;
    const system = getSystem(p.systemId);
    const platformId = system ? IGDB_PLATFORM_BY_SLUG[system.slug] : undefined;
    if (!platformId) return { items: [], page, hasMore: false, supported: false };
    const genreId = p.filter?.startsWith('g:') ? Number(p.filter.slice(2)) : undefined;
    const themeId = p.filter?.startsWith('t:') ? Number(p.filter.slice(2)) : undefined;
    const { items, hasMore } = await igdbProvider.listByPlatform(platformId, {
      search: p.search,
      page,
      sort: p.sort,
      genreId,
      themeId,
    });
    return { items: markFavorites(p.systemId, items), page, hasMore, supported: true };
  });

  registerInvoke('catalog:gameDetails', async (req) => {
    const p = gameDetailsSchema.parse(req);
    const detail = await igdbProvider.getGameDetails(p.igdbId);
    if (!detail) return null;
    // Enrich with LaunchBox data for the title's platform (no-op if not imported/matched).
    const slug = p.systemId != null ? getSystem(p.systemId)?.slug : undefined;
    return slug ? enrichCatalogDetail(detail, slug) : detail;
  });

  // Download gating: a title is available only when the platform has a configured
  // download source AND the provider high-confidence-matches the IGDB title to a
  // file. No source configured (or no match) -> greyed.
  registerInvoke('catalog:availability', async (req) => {
    const p = platformGameSchema.parse(req);
    const favorite = findBySystemIgdb(p.systemId, p.igdbId)?.favorite === 1;
    if (!hasAnySourceForSystem(p.systemId)) return { available: false, favorite };
    const detail = await igdbProvider.getGameDetails(p.igdbId);
    if (!detail) return { available: false, favorite };
    const resolved = await matchAnySourceForSystem(p.systemId, detail.name);
    if (!resolved) return { available: false, favorite };
    // If this title was already acquired, surface its owned ids so the detail page
    // re-attaches to the in-flight (or completed) download instead of re-offering it.
    // upsertArchiveFile dedupes by the opaque storage_key, so the matched filename
    // is the same key the owned row carries.
    const owned = getFileByStorageKey(resolved.match.filename);
    // Surface the matched filename + size (opaque, verbatim) so the UI can show a
    // "matched" state. md5 is intentionally not exposed.
    return {
      available: true,
      filename: resolved.match.filename,
      sizeBytes: resolved.match.sizeBytes,
      gameId: owned?.game_id ?? null,
      gameFileId: owned?.id ?? null,
      cached: owned?.cache_state === 'cached',
      favorite,
    };
  });

  // Acquires a matched catalog game: creates the owned game + file (source records
  // the exact Archive item for download routing), then routes it through the DownloadManager.
  registerInvoke('catalog:download', async (req) => {
    const p = platformGameSchema.parse(req);
    if (!hasAnySourceForSystem(p.systemId)) throw new Error('No download source for this platform.');
    const detail = await igdbProvider.getGameDetails(p.igdbId);
    if (!detail) throw new Error('Game not found.');
    const resolved = await matchAnySourceForSystem(p.systemId, detail.name);
    if (!resolved) throw new Error('This title is not available to download.');
    const { gameId, gameFileId } = upsertArchiveFile({
      systemId: p.systemId,
      title: detail.name,
      storageKey: resolved.match.filename,
      sizeBytes: resolved.match.sizeBytes,
      md5: resolved.match.md5,
      source: resolved.source, // 'archive-org:<id>' or 'minerva:<collection>'
      igdbId: p.igdbId, // converge onto a pre-existing favorite row for this title
    });
    // Cover: prefer the LaunchBox retail case front (the actual box, console branding
    // included); fall back to the IGDB cover already cached from catalog browsing.
    await applyBestCover(gameId, p.systemId, detail.name, detail.coverUrl);
    // Acquire only if the bytes aren't already present (re-click / already-owned = no-op).
    const file = getFileRow(gameFileId);
    if (!file || file.cache_state !== 'cached') enqueue(gameFileId, 50);
    return { gameId, gameFileId };
  });

  // Add/remove a catalog title to My List. Favoriting an un-owned title creates a
  // file-less games row (so it shows everywhere with a "not downloaded" glyph); a later
  // download attaches to that same row. Un-favoriting a file-less row removes it.
  registerInvoke('catalog:setFavorite', async (req) => {
    const p = setFavoriteSchema.parse(req);
    if (p.favorite) {
      const detail = await igdbProvider.getGameDetails(p.igdbId);
      if (!detail) throw new Error('Game not found.');
      const game = createCatalogFavorite({
        systemId: p.systemId,
        igdbId: p.igdbId,
        title: detail.name,
        releaseDate: detail.releaseDate,
        genre: detail.genres[0] ?? null,
      });
      // Cover: LaunchBox case front preferred, IGDB cover (cached from browsing) fallback.
      await applyBestCover(game.id, p.systemId, detail.name, detail.coverUrl);
      return { favorite: true, gameId: game.id };
    }
    const existing = findBySystemIgdb(p.systemId, p.igdbId);
    if (!existing) return { favorite: false, gameId: null };
    if (existing.has_files === 1) {
      setFavorite(existing.id, false); // owned - keep the game, just un-list it
      return { favorite: false, gameId: existing.id };
    }
    await removeGameFromLibrary(existing.id); // file-less favorite - drop it entirely
    return { favorite: false, gameId: null };
  });

}
