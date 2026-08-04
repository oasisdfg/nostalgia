// TheGamesDB provider (fallback, name match). MAIN PROCESS ONLY. No hash search;
// searchByName uses ByGameName with boxart included. API key read in-process.
import type {
  MetadataProvider,
  MetadataMatch,
  HashQuery,
  NormalizedMetadata,
  MediaRef,
  RateLimitState,
} from '@shared/contracts/metadata';
import { getTheGamesDbApiKey } from '../credentials';

const API = 'https://api.thegamesdb.net/v1';

interface TgdbGame {
  id: number;
  game_title: string;
  release_date?: string;
  overview?: string;
  players?: number;
  rating?: string;
}
interface TgdbBoxartImage {
  type: string;
  side?: string;
  filename: string;
}

const games = new Map<string, TgdbGame>();
const boxart = new Map<string, TgdbBoxartImage[]>();
let boxartBaseUrl = '';

export const theGamesDbProvider: MetadataProvider = {
  id: 'thegamesdb',

  async searchByHash(_query: HashQuery): Promise<MetadataMatch[]> {
    return []; // TheGamesDB has no hash search.
  },

  async searchByName(title: string): Promise<MetadataMatch[]> {
    const apikey = getTheGamesDbApiKey();
    if (!apikey) throw new Error('TheGamesDB API key is not configured.');
    const qs = new URLSearchParams({
      apikey,
      name: title,
      fields: 'players,overview,rating,release_date',
      include: 'boxart',
    });
    const res = await fetch(`${API}/Games/ByGameName?${qs.toString()}`);
    if (!res.ok) throw new Error(`TheGamesDB request failed (HTTP ${res.status}).`);
    const json = (await res.json()) as {
      data?: { games?: TgdbGame[] };
      include?: { boxart?: { base_url?: Record<string, string>; data?: Record<string, TgdbBoxartImage[]> } };
    };
    const list = json.data?.games ?? [];
    boxartBaseUrl = json.include?.boxart?.base_url?.original ?? boxartBaseUrl;
    const ba = json.include?.boxart?.data ?? {};
    for (const g of list) {
      games.set(String(g.id), g);
      if (ba[String(g.id)]) boxart.set(String(g.id), ba[String(g.id)]);
    }
    return list.slice(0, 5).map((g, i) => ({
      provider: 'thegamesdb' as const,
      providerGameId: String(g.id),
      title: g.game_title,
      matchedBy: 'title' as const,
      confidence: i === 0 ? 0.55 : 0.4,
    }));
  },

  async getGameDetails(providerGameId: string): Promise<NormalizedMetadata> {
    const g = games.get(providerGameId);
    if (!g) throw new Error('TheGamesDB details not available; search first.');
    const rating = g.rating ? Number.parseFloat(g.rating) : null;
    return {
      title: g.game_title,
      description: g.overview ?? null,
      releaseDate: g.release_date ?? null,
      genre: null,
      players: g.players ?? null,
      rating: rating != null && Number.isFinite(rating) ? Math.max(0, Math.min(1, rating / 10)) : null,
      regions: [],
    };
  },

  async getMedia(providerGameId: string): Promise<MediaRef[]> {
    const images = boxart.get(providerGameId);
    if (!images || !boxartBaseUrl) return [];
    const out: MediaRef[] = [];
    for (const img of images) {
      if (img.type === 'boxart' && img.filename) {
        out.push({ type: img.side === 'back' ? 'fanart' : 'box2d', url: boxartBaseUrl + img.filename });
      }
    }
    return out;
  },

  getRateLimitState(): RateLimitState {
    return { provider: 'thegamesdb', remaining: null, limit: null, blockedUntil: null };
  },
};

export function __resetTheGamesDbCache(): void {
  games.clear();
  boxart.clear();
  boxartBaseUrl = '';
}
