// Provider-agnostic metadata scraping contract.
// ScreenScraper.fr primary, TheGamesDB fallback. Types only.

import type { HashAlgo } from './storage';

export type MetadataProviderId = 'launchbox' | 'screenscraper' | 'thegamesdb';
export type MatchedBy = 'hash' | 'filename' | 'title' | 'manual';
export type MediaType =
  | 'box2d'
  | 'box3d'
  | 'wheel'
  | 'logo'
  | 'marquee'
  | 'screenshot'
  | 'fanart'
  | 'video';

export interface HashQuery {
  crc32?: string;
  md5?: string;
  sha1?: string;
  size?: number;
}

export interface MetadataMatch {
  provider: MetadataProviderId;
  providerGameId: string;
  title: string;
  matchedBy: MatchedBy;
  /** 0..1 */
  confidence: number;
}

export interface MediaRef {
  type: MediaType;
  url: string;
  region?: string | null;
  resolution?: string | null;
}

export interface NormalizedMetadata {
  title: string;
  description: string | null;
  /** ISO-ish date string as provided */
  releaseDate: string | null;
  genre: string | null;
  players: number | null;
  /** normalized 0..1 */
  rating: number | null;
  regions: string[];
}

export interface RateLimitState {
  provider: MetadataProviderId;
  remaining: number | null;
  limit: number | null;
  /** epoch ms until which the provider is throttled, or null */
  blockedUntil: number | null;
}

export interface MetadataProvider {
  readonly id: MetadataProviderId;
  searchByHash(query: HashQuery, systemSlug: string): Promise<MetadataMatch[]>;
  searchByName(title: string, systemSlug: string): Promise<MetadataMatch[]>;
  getGameDetails(providerGameId: string): Promise<NormalizedMetadata>;
  getMedia(providerGameId: string): Promise<MediaRef[]>;
  getRateLimitState(): RateLimitState;
}

export interface ResolvedMetadata {
  match: MetadataMatch;
  details: NormalizedMetadata;
  media: MediaRef[];
}

export interface MetadataResolver {
  readonly chain: MetadataProviderId[];
  resolveByHash(query: HashQuery, systemSlug: string): Promise<ResolvedMetadata | null>;
  resolveByName(title: string, systemSlug: string): Promise<ResolvedMetadata | null>;
  resolveManual(provider: MetadataProviderId, providerGameId: string): Promise<ResolvedMetadata | null>;
  getQuota(): RateLimitState[];
}

export type { HashAlgo };
