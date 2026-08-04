// Merges LaunchBox data into an IGDB CatalogGameDetail. IGDB stays primary; LaunchBox
// fills nulls (overview) and adds fields IGDB doesn't have (clear logo, community rating,
// ESRB, players, co-op, developer/publisher, trailer URL). MAIN PROCESS ONLY.
import { nativeImage } from 'electron';
import { lookup } from '../db/repositories/launchboxRepo';
import { launchboxPlatformForSlug } from './platformMap';
import { normalizeLbTitle } from './normalizeTitle';
import { cacheLaunchboxImage, cacheLaunchboxImageFile } from '../catalog/imageCache';
import type { CatalogGameDetail } from '@shared/contracts/catalog';
import type { LbImageRow } from '../db/repositories/launchboxRepo';

// LaunchBox ships one image row per region/language variant of an artwork (Pokémon
// Emerald's Clear Logos include the German "Smaragd-Edition"). Prefer English-market
// regions; an untagged row ranks between World and Europe (usually the primary art).
const IMAGE_REGION_RANK: Record<string, number> = {
  'United States': 7,
  'North America': 6,
  World: 5,
  // (untagged/null → 4)
  'United Kingdom': 3,
  Europe: 2,
};
const imageRegionRank = (region: string | null): number =>
  region == null ? 4 : (IMAGE_REGION_RANK[region] ?? 1);

/** The best image of a type: highest region rank wins (ties keep LaunchBox order). */
function pickImage(images: LbImageRow[], type: string): LbImageRow | undefined {
  let best: LbImageRow | undefined;
  for (const i of images) {
    if (i.type !== type) continue;
    if (!best || imageRegionRank(i.region) > imageRegionRank(best.region)) best = i;
  }
  return best;
}

/** All images of a type, best region first (stable within a rank). */
function rankedImages(images: LbImageRow[], type: string): LbImageRow[] {
  return images
    .filter((i) => i.type === type)
    .sort((a, b) => imageRegionRank(b.region) - imageRegionRank(a.region));
}

// PlayStation-family consoles whose reissue covers are detectable by color: the
// ORIGINAL case always has a black header band, while "Greatest Hits" / "Double Pack"
// reissues replace it with a red band (green on PS1). LaunchBox's metadata carries no
// variant flag, so the band color is the only reliable original-vs-reissue signal.
const REISSUE_BAND_SLUGS = new Set(['ps1', 'ps2', 'ps3', 'psp']);

/** Fraction of strongly red/green pixels in the cover's top strip (reissue banding). */
function reissueBandScore(absPath: string): number {
  try {
    let img = nativeImage.createFromPath(absPath);
    if (img.isEmpty()) return 0;
    img = img.resize({ width: 64 });
    const { width, height } = img.getSize();
    const buf = img.toBitmap(); // BGRA
    const rows = Math.max(1, Math.round(height * 0.14));
    let hits = 0;
    let total = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const b = buf[i];
        const g = buf[i + 1];
        const r = buf[i + 2];
        const red = r > 90 && r > g * 1.7 && r > b * 1.7;
        const green = g > 90 && g > r * 1.5 && g > b * 1.3;
        if (red || green) hits++;
        total++;
      }
    }
    return total ? hits / total : 0;
  } catch {
    return 0;
  }
}

/**
 * Retail-disc entry to borrow box art from when a title's OWN art is unusable.
 *
 * LaunchBox lists the PS3 HD re-releases individually, but those entries describe the PSN
 * *digital* SKUs and some carry a square storefront tile instead of a case scan (see
 * isStorefrontTile). The discs these shipped on are the two Collections, whose entries have
 * proper multi-region retail scans. Consulted ONLY as a fallback, so a title with a real
 * box front of its own keeps it - otherwise both halves of a collection would show the
 * same cover and read as a duplicate.
 */
const COLLECTION_BOX_ART_FALLBACK: Record<string, string> = {
  godofwar: 'godofwarcollection', // God of War Collection (I + II HD)
  godofwarii: 'godofwarcollection',
  godofwarchainsofolympus: 'godofwaroriginscollection', // God of War Origins Collection
  godofwarghostofsparta: 'godofwaroriginscollection',
};

// Consoles whose retail case is unmistakably PORTRAIT (disc-era keep cases and UMD/DVD
// sleeves), so a square scan among them can only be a PSN/eShop storefront tile. The
// square test is valid ONLY here: a Game Boy Advance box is genuinely square (LaunchBox's
// US FireRed scan is 2907x2907), and a cartridge-era box judged by this rule would have
// its correct regional art thrown away in favour of whatever oddly-shaped scan came next.
const PORTRAIT_CASE_SLUGS = new Set(['ps1', 'ps2', 'ps3', 'psp', 'xbox', 'xbox360', 'gamecube', 'wii', 'wiiu', 'switch']);

/**
 * True when an image is a storefront tile rather than a retail case scan.
 *
 * PSN/eShop store icons are perfectly SQUARE (1024x1024), while a real case scan on these
 * consoles is portrait (~0.87 w/h - a 1530x1760 PS3 sleeve). LaunchBox files both under
 * "Box - Front", so on a portrait-case console the aspect ratio is a reliable
 * discriminator, and a square tile among real cases is exactly what reads as "wrong art".
 */
function isStorefrontTile(absPath: string, screenTiles: boolean): boolean {
  if (!screenTiles) return false;
  try {
    const img = nativeImage.createFromPath(absPath);
    if (img.isEmpty()) return false;
    const { width, height } = img.getSize();
    if (!width || !height) return false;
    const aspect = width / height;
    return aspect > 0.95 && aspect < 1.05;
  } catch {
    return false; // unreadable - let the normal path decide
  }
}

/**
 * First usable case scan from a ranked candidate list: skips storefront tiles, and on
 * PlayStation-family consoles prefers an original over a reissue-banded scan.
 * `fallback` is the best non-tile candidate seen even if every one was a reissue.
 */
async function chooseBoxFront(
  candidates: LbImageRow[],
  screenBand: boolean,
  screenTiles: boolean,
): Promise<{ url: string | null; fallback: string | null }> {
  let fallback: string | null = null;
  for (const cand of candidates.slice(0, 5)) {
    const f = await cacheLaunchboxImageFile(cand.file_name).catch(() => null);
    if (!f) continue;
    if (isStorefrontTile(f.path, screenTiles)) continue;
    fallback ??= f.url;
    if (!screenBand || reissueBandScore(f.path) < 0.22) return { url: f.url, fallback };
  }
  return { url: null, fallback };
}

/**
 * The real retail case front ("Box - Front", US-market region preferred) for a title on
 * a console, cached to the assets folder - or null when the LaunchBox DB isn't imported,
 * the title doesn't match, or the game has no box scan. On PlayStation-family consoles
 * the candidates are screened for reissue banding (Greatest Hits red / PS1 green), so
 * the ORIGINAL art wins whenever the DB carries one; if every scan is a reissue, the
 * best-ranked one is still returned rather than nothing.
 */
export async function boxFrontAssetUrl(title: string, slug: string): Promise<string | null> {
  const platform = launchboxPlatformForSlug(slug);
  if (!platform) return null;
  const titleNorm = normalizeLbTitle(title);
  const screenBand = REISSUE_BAND_SLUGS.has(slug);
  const screenTiles = PORTRAIT_CASE_SLUGS.has(slug);

  // The title's OWN art always wins when it is a real case scan, so two halves of one
  // collection keep their distinct covers.
  const own = rankedImages(lookup(titleNorm, platform)?.images ?? [], 'Box - Front');
  const ownPick = await chooseBoxFront(own, screenBand, screenTiles);
  if (ownPick.url) return ownPick.url;

  // Own art is missing or is a storefront tile - borrow the retail disc's scan.
  const collection = COLLECTION_BOX_ART_FALLBACK[titleNorm];
  if (collection) {
    const collPick = await chooseBoxFront(rankedImages(lookup(collection, platform)?.images ?? [], 'Box - Front'), screenBand, screenTiles);
    if (collPick.url) return collPick.url;
    if (collPick.fallback) return collPick.fallback;
  }

  // Every candidate was a reissue scan, or every one was a tile. Prefer a reissue case
  // over a tile, but never leave a game with no cover at all when the DB has something.
  if (ownPick.fallback) return ownPick.fallback;
  return own.length > 0 ? await cacheLaunchboxImage(own[0].file_name).catch(() => null) : null;
}

export async function enrichCatalogDetail(detail: CatalogGameDetail, slug: string): Promise<CatalogGameDetail> {
  const platform = launchboxPlatformForSlug(slug);
  if (!platform) return detail;
  const hit = lookup(normalizeLbTitle(detail.name), platform);
  if (!hit) return detail;
  const { game, images } = hit;

  const logo = pickImage(images, 'Clear Logo');
  let clearLogoUrl: string | null = null;
  if (logo) clearLogoUrl = await cacheLaunchboxImage(logo.file_name).catch(() => null);

  return {
    ...detail,
    summary: detail.summary ?? game.overview,
    clearLogoUrl,
    communityRating: game.community_rating,
    communityRatingCount: game.community_rating_count,
    esrb: game.esrb,
    maxPlayers: game.max_players,
    cooperative: game.cooperative === 1,
    developer: game.developer,
    publisher: game.publisher,
    videoUrl: game.video_url,
  };
}
