// IGDB HTTP client - MAIN PROCESS ONLY. Twitch client_credentials OAuth with an
// in-memory token cache, a ~4 req/sec rate limiter, and 401-refresh. The secret
// and token are never logged and never leave main.
import { getClientId, getClientSecret } from './credentials';

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const IGDB_URL = 'https://api.igdb.com/v4';
const MIN_INTERVAL_MS = 260; // ~3.8 req/s, safely under IGDB's 4/s

export class IgdbError extends Error {}

// --- Pure helpers (exported for tests) ---

export type ImageSize =
  | 't_cover_big'
  | 't_cover_big_2x'
  | 't_cover_small'
  | 't_screenshot_med'
  | 't_screenshot_big'
  | 't_1080p'
  | 't_720p'
  | 't_thumb';

export function igdbImageUrl(imageId: string, size: ImageSize): string {
  return `https://images.igdb.com/igdb/image/upload/${size}/${imageId}.jpg`;
}

const GAME_FIELDS =
  'fields name,summary,first_release_date,genres.name,involved_companies.company.name,cover.image_id,screenshots.image_id,artworks.image_id,artworks.width,artworks.height,game_modes.name,multiplayer_modes.onlinemax,multiplayer_modes.offlinemax,platforms,total_rating_count,aggregated_rating;';

/**
 * Minimum community rating count for a game to appear without an aggregated
 * (critic) rating. The single knob for catalog strictness - lower it if a real
 * but obscure title is being excluded.
 */
export const MIN_RATING_COUNT = 5;

// Restrict to legitimate commercial releases: main games / remakes / remasters /
// expanded games / ports (type 0,8,9,10,11), with real provenance (companies +
// cover + release date) and visibility (community votes or a critic rating).
// Excludes mods, fan content, episodes, forks, packs, updates, and bare uploads.
// IGDB migrated the old `category` field to `game_type` (same enum values);
// `category` is now empty in the data, so we filter on `game_type`.
const CATALOG_FILTERS =
  `game_type = (0,8,9,10,11)` +
  ` & involved_companies != null` +
  ` & cover != null` +
  ` & first_release_date != null` +
  ` & (total_rating_count >= ${MIN_RATING_COUNT} | aggregated_rating != null)`;

export interface GamesQueryOptions {
  platformId: number;
  search?: string;
  limit: number;
  offset: number;
  /** 'popular' | 'releaseDate' | 'rating' | 'exclusives' (default 'popular') */
  sort?: string;
  /** only games FIRST released on/after this epoch-seconds (ports of older games drop out) */
  nativeAfter?: number;
  /** for 'exclusives': game must not appear on any of these platform ids */
  excludePlatforms?: number[];
  genreId?: number;
  themeId?: number;
}

export function buildGamesQuery(o: GamesQueryOptions): string {
  const clauses = [`platforms = (${o.platformId})`, CATALOG_FILTERS];
  const searching = !!(o.search && o.search.trim());
  // The natives-only filter applies to BROWSING, never to search - searching a console's
  // section is exactly how the user finds a port of an older game there.
  if (!searching && o.nativeAfter != null) clauses.push(`first_release_date >= ${o.nativeAfter}`);
  if (o.sort === 'exclusives' && o.excludePlatforms && o.excludePlatforms.length > 0) {
    clauses.push(`platforms != (${o.excludePlatforms.join(',')})`);
  }
  if (o.sort === 'rating') clauses.push('total_rating != null');
  if (o.genreId != null) clauses.push(`genres = (${o.genreId})`);
  if (o.themeId != null) clauses.push(`themes = (${o.themeId})`);

  const parts: string[] = [GAME_FIELDS];
  if (searching) {
    // `search` provides its own relevance ordering; the same filters still apply.
    parts.push(`search "${o.search!.trim().replace(/"/g, '\\"')}";`);
    parts.push(`where ${clauses.join(' & ')};`);
  } else {
    parts.push(`where ${clauses.join(' & ')};`);
    const sort =
      o.sort === 'releaseDate' ? 'first_release_date desc'
      : o.sort === 'rating' ? 'total_rating desc'
      : 'total_rating_count desc'; // 'popular' + 'exclusives'
    parts.push(`sort ${sort};`);
  }
  parts.push(`limit ${o.limit};`);
  parts.push(`offset ${o.offset};`);
  return parts.join(' ');
}

export function buildGameByIdQuery(igdbId: number): string {
  return `${GAME_FIELDS} where id = ${igdbId}; limit 1;`;
}

// --- Rate limiter ---

let lastSlot = 0;
let chain: Promise<void> = Promise.resolve();

export function acquireSlot(): Promise<void> {
  chain = chain.then(async () => {
    const wait = Math.max(0, lastSlot + MIN_INTERVAL_MS - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastSlot = Date.now();
  });
  return chain;
}

// --- Token management ---

interface Token {
  value: string;
  expiresAt: number;
}
let token: Token | null = null;
let inflight: Promise<string> | null = null;

async function fetchToken(): Promise<string> {
  const id = getClientId();
  const secret = getClientSecret();
  if (!id || !secret) throw new IgdbError('IGDB credentials are not configured.');
  const url = `${TOKEN_URL}?client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(secret)}&grant_type=client_credentials`;
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) throw new IgdbError(`Token exchange failed (HTTP ${res.status}).`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new IgdbError('Token exchange returned no access token.');
  token = { value: json.access_token, expiresAt: Date.now() + ((json.expires_in ?? 3600) - 60) * 1000 };
  return token.value;
}

export async function getToken(force = false): Promise<string> {
  if (force) token = null;
  if (token && token.expiresAt > Date.now()) return token.value;
  if (!inflight) inflight = fetchToken().finally(() => (inflight = null));
  return inflight;
}

/** POSTs an Apicalypse query to an IGDB endpoint, rate-limited, refreshing on 401. */
export async function igdbPost<T>(endpoint: string, body: string): Promise<T> {
  const id = getClientId();
  if (!id) throw new IgdbError('IGDB credentials are not configured.');

  const send = async (tok: string): Promise<Response> => {
    await acquireSlot();
    return fetch(`${IGDB_URL}/${endpoint}`, {
      method: 'POST',
      headers: { 'Client-ID': id, Authorization: `Bearer ${tok}`, Accept: 'application/json' },
      body,
    });
  };

  let res = await send(await getToken());
  if (res.status === 401) res = await send(await getToken(true));
  if (!res.ok) throw new IgdbError(`IGDB request failed (HTTP ${res.status}).`);
  return (await res.json()) as T;
}
