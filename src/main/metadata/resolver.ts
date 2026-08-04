import type {
  MetadataResolver,
  MetadataProvider,
  MetadataProviderId,
  ResolvedMetadata,
  MetadataMatch,
  HashQuery,
  RateLimitState,
} from '@shared/contracts/metadata';
import { launchBoxProvider } from './providers/launchBox';
import { screenScraperProvider } from './providers/screenScraper';
import { theGamesDbProvider } from './providers/theGamesDb';

// LaunchBox first: it's the primary source (exact title+platform, local, no credentials).
const CHAIN: MetadataProviderId[] = ['launchbox', 'screenscraper', 'thegamesdb'];
const providers: Record<MetadataProviderId, MetadataProvider> = {
  launchbox: launchBoxProvider,
  screenscraper: screenScraperProvider,
  thegamesdb: theGamesDbProvider,
};

async function resolveFrom(provider: MetadataProvider, match: MetadataMatch): Promise<ResolvedMetadata> {
  const [details, media] = await Promise.all([
    provider.getGameDetails(match.providerGameId),
    provider.getMedia(match.providerGameId),
  ]);
  return { match, details, media };
}

export const metadataResolver: MetadataResolver = {
  chain: CHAIN,

  async resolveByHash(query: HashQuery, systemSlug: string): Promise<ResolvedMetadata | null> {
    try {
      const matches = await providers.screenscraper.searchByHash(query, systemSlug);
      if (matches[0]) return await resolveFrom(providers.screenscraper, matches[0]);
    } catch {
      /* provider error/no-match → fall through */
    }
    return null;
  },

  async resolveByName(title: string, systemSlug: string): Promise<ResolvedMetadata | null> {
    for (const id of CHAIN) {
      try {
        const matches = await providers[id].searchByName(title, systemSlug);
        if (matches[0]) return await resolveFrom(providers[id], matches[0]);
      } catch {
        /* try next provider */
      }
    }
    return null;
  },

  async resolveManual(provider: MetadataProviderId, providerGameId: string): Promise<ResolvedMetadata | null> {
    try {
      const p = providers[provider];
      const [details, media] = await Promise.all([p.getGameDetails(providerGameId), p.getMedia(providerGameId)]);
      return {
        match: { provider, providerGameId, title: details.title, matchedBy: 'manual', confidence: 1 },
        details,
        media,
      };
    } catch {
      return null;
    }
  },

  getQuota(): RateLimitState[] {
    return [providers.screenscraper.getRateLimitState(), providers.thegamesdb.getRateLimitState()];
  },
};

/** LaunchBox-only name resolve - the primary lane, run before the ScreenScraper hash
 *  backstop so LaunchBox wins for titles it has (exact title+platform match). */
export async function resolveViaLaunchBox(title: string, systemSlug: string): Promise<ResolvedMetadata | null> {
  try {
    const matches = await providers.launchbox.searchByName(title, systemSlug);
    if (matches[0]) return await resolveFrom(providers.launchbox, matches[0]);
  } catch {
    /* no LaunchBox match / not imported → fall through */
  }
  return null;
}

/** Aggregates name-search candidates across the chain (for manual selection). */
export async function searchCandidates(title: string, systemSlug: string): Promise<MetadataMatch[]> {
  const out: MetadataMatch[] = [];
  for (const id of CHAIN) {
    try {
      out.push(...(await providers[id].searchByName(title, systemSlug)));
    } catch {
      /* skip provider */
    }
  }
  return out;
}
