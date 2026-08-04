// Provider-agnostic game catalog (the browsable universe of titles per platform),
// distinct from MetadataProvider (hash-based art/match for owned files). IGDB is
// the shipped implementation. Types only.

export interface CatalogListItem {
  igdbId: number;
  name: string;
  /** asset:// URL to a cached cover, or null */
  coverUrl: string | null;
  releaseYear: number | null;
  /** Whether this title is in the user's My List. Populated by list handlers that know
   *  the system context; defaults false. */
  favorite?: boolean;
}

export interface CatalogGameDetail {
  igdbId: number;
  name: string;
  summary: string | null;
  /** ISO date string, or null */
  releaseDate: string | null;
  genres: string[];
  companies: string[];
  gameModes: string[];
  /** human-readable player support, e.g. "1-4 players" or null */
  players: string | null;
  coverUrl: string | null;
  /** asset:// URLs to cached screenshots */
  screenshots: string[];
  /** asset:// URLs to cached high-res key artwork (better than a screenshot for the hero background) */
  artworks: string[];
  platformId: number;

  // --- LaunchBox enrichment (null/absent until the LaunchBox DB is imported and matched) ---
  /** asset:// URL of a transparent clear logo (replaces the text title when present). */
  clearLogoUrl?: string | null;
  /** LaunchBox community rating, 0..5. */
  communityRating?: number | null;
  communityRatingCount?: number | null;
  /** ESRB label, e.g. "M - Mature". */
  esrb?: string | null;
  maxPlayers?: number | null;
  cooperative?: boolean;
  developer?: string | null;
  publisher?: string | null;
  /** YouTube trailer URL - opened via app:openExternal (never embedded; CSP forbids it). */
  videoUrl?: string | null;
}

export interface CatalogListResult {
  items: CatalogListItem[];
  page: number;
  hasMore: boolean;
  /** false when the system has no catalog platform mapping */
  supported: boolean;
}

/**
 * Catalog sort modes. 'popular' (default) also filters to games ORIGINALLY released on
 * this console (first release on/after the console's launch), so ports of older games
 * don't top every console's grid - they stay reachable via search, which skips that
 * filter. 'exclusives' = never released on a rival manufacturer's console.
 */
export type CatalogSort = 'popular' | 'releaseDate' | 'rating' | 'exclusives';

/** A genre/theme filter option for the catalog (IGDB genre or theme id). */
export interface CatalogFilterOption {
  label: string;
  /** 'g:<genreId>' or 't:<themeId>' */
  value: string;
}

// IGDB genre/theme ids are stable public constants. Action/Horror/Stealth are IGDB
// *themes*, the rest are *genres* - encoded in the value prefix.
export const CATALOG_FILTER_OPTIONS: CatalogFilterOption[] = [
  { label: 'Action', value: 't:1' },
  { label: 'Adventure', value: 'g:31' },
  { label: 'Shooter', value: 'g:5' },
  { label: 'RPG', value: 'g:12' },
  { label: 'Platformer', value: 'g:8' },
  { label: 'Racing', value: 'g:10' },
  { label: 'Fighting', value: 'g:4' },
  { label: 'Sports', value: 'g:14' },
  { label: 'Strategy', value: 'g:15' },
  { label: 'Puzzle', value: 'g:9' },
  { label: 'Simulation', value: 'g:13' },
  { label: 'Horror', value: 't:19' },
  { label: 'Stealth', value: 't:23' },
];

export interface CatalogConnectionResult {
  ok: boolean;
  message: string;
}

export interface CatalogProvider {
  listByPlatform(
    platformId: number,
    opts: { search?: string; page?: number; sort?: CatalogSort; genreId?: number; themeId?: number },
  ): Promise<{ items: CatalogListItem[]; hasMore: boolean }>;
  getGameDetails(igdbId: number): Promise<CatalogGameDetail | null>;
  testConnection(): Promise<CatalogConnectionResult>;
}

/**
 * Per-console theming for a system's library view: an accent (overrides the
 * global emerald within that view) and an implied faint background wash. Accents
 * are "R G B" triplets, chosen mid-bright so they read on near-black and keep
 * near-black button text legible. Systems without an entry keep the default theme.
 */
export interface PlatformTheme {
  accent: string;
}
export const PLATFORM_THEMES: Record<string, PlatformTheme> = {
  ps1: { accent: '78 138 232' }, // deep blue
  ps2: { accent: '64 118 224' }, // deep blue
  ps3: { accent: '170 182 198' }, // black/silver -> silver
  psp: { accent: '128 146 166' }, // gunmetal
  xbox360: { accent: '74 198 112' }, // green
  xbox: { accent: '74 198 112' }, // green
  gamecube: { accent: '128 110 226' }, // indigo/purple
  wii: { accent: '118 200 248' }, // white/light-blue
  snes: { accent: '154 134 200' }, // purple/grey
  gba: { accent: '104 112 234' }, // indigo
  ds: { accent: '150 182 216' }, // silver/blue
  n64: { accent: '214 96 78' }, // red
  '3ds': { accent: '72 186 205' }, // Aqua Blue
};

/** Our system slug -> IGDB platform id. Systems not listed have no catalog. */
export const IGDB_PLATFORM_BY_SLUG: Record<string, number> = {
  xbox360: 12,
  ps3: 9,
  ps2: 8,
  ps1: 7,
  psp: 38,
  ds: 20,
  '3ds': 37,
  gba: 24,
  snes: 19,
  xbox: 11,
  gamecube: 21,
  wii: 5,
  n64: 4,
  nes: 18,
  wiiu: 41,
  switch: 130,
  atari2600: 59,
  genesis: 29,
  saturn: 32,
  dreamcast: 23,
};
