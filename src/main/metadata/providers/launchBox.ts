// LaunchBox metadata provider - the PRIMARY owned-game scraper. Backed entirely by the
// locally-imported LaunchBox DB (no network, no credentials, no rate limit). Matches by
// normalized title + platform (LaunchBox has no hashes), so it plugs into the resolver's
// name lane only; searchByHash is a no-op. MAIN PROCESS ONLY.
import { lookup, getByDatabaseId, type LbImageRow } from '../../db/repositories/launchboxRepo';
import { launchboxPlatformForSlug } from '../../launchbox/platformMap';
import { normalizeLbTitle } from '../../launchbox/normalizeTitle';
import type {
  MetadataProvider,
  MetadataMatch,
  NormalizedMetadata,
  MediaRef,
  MediaType,
  RateLimitState,
} from '@shared/contracts/metadata';

const IMAGE_BASE = 'https://images.launchbox-app.com/';

// The 4 image types the importer keeps (see launchbox/importer.ts) → our MediaType.
const IMAGE_TYPE_MAP: Record<string, MediaType> = {
  'Box - Front': 'box2d',
  'Clear Logo': 'logo',
  'Fanart - Background': 'fanart',
  Banner: 'marquee',
};

// English-market regions preferred (mirrors launchbox/enrich.ts pickImage).
const IMAGE_REGION_RANK: Record<string, number> = {
  'United States': 7,
  'North America': 6,
  World: 5,
  'United Kingdom': 3,
  Europe: 2,
};
const regionRank = (region: string | null): number => (region == null ? 4 : (IMAGE_REGION_RANK[region] ?? 1));

function imageUrl(fileName: string): string {
  return IMAGE_BASE + fileName.split('/').map(encodeURIComponent).join('/');
}

/** One MediaRef per artwork type, choosing the best-region image of each. */
function toMedia(images: LbImageRow[]): MediaRef[] {
  const best = new Map<MediaType, LbImageRow>();
  for (const img of images) {
    const type = IMAGE_TYPE_MAP[img.type];
    if (!type) continue;
    const cur = best.get(type);
    if (!cur || regionRank(img.region) > regionRank(cur.region)) best.set(type, img);
  }
  return [...best.entries()].map(([type, img]) => ({ type, url: imageUrl(img.file_name), region: img.region }));
}

function toDetails(game: NonNullable<ReturnType<typeof getByDatabaseId>>['game']): NormalizedMetadata {
  return {
    title: game.title,
    description: game.overview,
    releaseDate: game.release_date,
    // LaunchBox genres are a "Action; Adventure" list - keep the primary genre.
    genre: game.genres ? (game.genres.split(/[;,]/)[0]?.trim() || null) : null,
    players: game.max_players,
    // community_rating is 0..5 stars → normalize to 0..1.
    rating: game.community_rating != null ? Math.max(0, Math.min(1, game.community_rating / 5)) : null,
    regions: [],
  };
}

export const launchBoxProvider: MetadataProvider = {
  id: 'launchbox',

  // LaunchBox has no hash index.
  async searchByHash(): Promise<MetadataMatch[]> {
    return [];
  },

  async searchByName(title: string, systemSlug: string): Promise<MetadataMatch[]> {
    const platform = launchboxPlatformForSlug(systemSlug);
    if (!platform) return [];
    const hit = lookup(normalizeLbTitle(title), platform);
    if (!hit) return [];
    return [
      {
        provider: 'launchbox',
        providerGameId: String(hit.game.database_id),
        title: hit.game.title,
        matchedBy: 'title',
        confidence: 0.9, // exact (title_norm, platform) match - high precision
      },
    ];
  },

  async getGameDetails(providerGameId: string): Promise<NormalizedMetadata> {
    const hit = getByDatabaseId(Number(providerGameId));
    if (!hit) throw new Error(`LaunchBox game ${providerGameId} not found`);
    return toDetails(hit.game);
  },

  async getMedia(providerGameId: string): Promise<MediaRef[]> {
    const hit = getByDatabaseId(Number(providerGameId));
    return hit ? toMedia(hit.images) : [];
  },

  getRateLimitState(): RateLimitState {
    return { provider: 'launchbox', remaining: null, limit: null, blockedUntil: null };
  },
};
