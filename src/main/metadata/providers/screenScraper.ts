// ScreenScraper.fr provider (primary, hash-first). MAIN PROCESS ONLY. One
// jeuInfos call returns game + media; we cache the raw result per id so
// getGameDetails/getMedia don't re-fetch. Credentials are read in-process.
import type {
  MetadataProvider,
  MetadataMatch,
  HashQuery,
  NormalizedMetadata,
  MediaRef,
  MediaType,
  RateLimitState,
} from '@shared/contracts/metadata';
import { getScreenScraperCredentials } from '../credentials';

const API = 'https://api.screenscraper.fr/api2/jeuInfos.php';
const SOFTNAME = 'Nostalgia';

interface SsText {
  region?: string;
  langue?: string;
  text?: string;
}
interface SsJeu {
  id?: number | string;
  noms?: SsText[];
  synopsis?: SsText[];
  dates?: SsText[];
  genres?: { noms?: SsText[] }[];
  joueurs?: { text?: string };
  note?: { text?: string };
  medias?: { type?: string; url?: string; region?: string }[];
}

const MEDIA_MAP: Record<string, MediaType> = {
  'box-2D': 'box2d',
  'box-3D': 'box3d',
  wheel: 'wheel',
  'wheel-hd': 'wheel',
  marquee: 'marquee',
  screenmarquee: 'marquee',
  ss: 'screenshot',
  sstitle: 'screenshot',
  fanart: 'fanart',
  video: 'video',
};

function pickText(items: SsText[] | undefined, prefer = ['us', 'wor', 'eu', 'ss', 'jp']): string | null {
  if (!items || items.length === 0) return null;
  for (const region of prefer) {
    const hit = items.find((i) => i.region === region || i.langue === region);
    if (hit?.text) return hit.text;
  }
  return items[0]?.text ?? null;
}

let lastQuota: RateLimitState = { provider: 'screenscraper', remaining: null, limit: null, blockedUntil: null };
const cache = new Map<string, SsJeu>();

async function jeuInfos(params: Record<string, string>): Promise<SsJeu | null> {
  const creds = getScreenScraperCredentials();
  if (!creds) throw new Error('ScreenScraper credentials are not configured.');
  const qs = new URLSearchParams({
    devid: creds.devId,
    devpassword: creds.devPassword,
    softname: SOFTNAME,
    output: 'json',
    ...(creds.ssId ? { ssid: creds.ssId } : {}),
    ...(creds.ssPassword ? { sspassword: creds.ssPassword } : {}),
    ...params,
  });
  const res = await fetch(`${API}?${qs.toString()}`);
  if (res.status === 404) return null; // ScreenScraper returns 404 for no match
  if (!res.ok) throw new Error(`ScreenScraper request failed (HTTP ${res.status}).`);
  const json = (await res.json()) as { response?: { jeu?: SsJeu; ssuser?: { maxrequestspermin?: string } } };
  const jeu = json.response?.jeu ?? null;
  if (jeu?.id != null) cache.set(String(jeu.id), jeu);
  return jeu;
}

function toMatch(jeu: SsJeu, matchedBy: MetadataMatch['matchedBy'], confidence: number): MetadataMatch {
  return {
    provider: 'screenscraper',
    providerGameId: String(jeu.id ?? ''),
    title: pickText(jeu.noms) ?? 'Unknown',
    matchedBy,
    confidence,
  };
}

export const screenScraperProvider: MetadataProvider = {
  id: 'screenscraper',

  async searchByHash(query: HashQuery): Promise<MetadataMatch[]> {
    const params: Record<string, string> = {};
    if (query.crc32) params.crc = query.crc32;
    if (query.md5) params.md5 = query.md5;
    if (query.sha1) params.sha1 = query.sha1;
    if (query.size != null) params.romtaille = String(query.size);
    if (Object.keys(params).length === 0) return [];
    const jeu = await jeuInfos(params);
    return jeu ? [toMatch(jeu, 'hash', 1)] : [];
  },

  async searchByName(title: string): Promise<MetadataMatch[]> {
    const jeu = await jeuInfos({ romnom: title });
    return jeu ? [toMatch(jeu, 'title', 0.6)] : [];
  },

  async getGameDetails(providerGameId: string): Promise<NormalizedMetadata> {
    const jeu = cache.get(providerGameId);
    if (!jeu) throw new Error('ScreenScraper details not available; search first.');
    const note = jeu.note?.text ? Number(jeu.note.text) : null;
    const players = jeu.joueurs?.text ? parseInt(jeu.joueurs.text, 10) : null;
    return {
      title: pickText(jeu.noms) ?? 'Unknown',
      description: pickText(jeu.synopsis),
      releaseDate: pickText(jeu.dates),
      genre: pickText(jeu.genres?.[0]?.noms),
      players: Number.isFinite(players) ? players : null,
      rating: note != null && Number.isFinite(note) ? Math.max(0, Math.min(1, note / 20)) : null,
      regions: (jeu.noms ?? []).map((n) => n.region).filter((x): x is string => !!x),
    };
  },

  async getMedia(providerGameId: string): Promise<MediaRef[]> {
    const jeu = cache.get(providerGameId);
    if (!jeu?.medias) return [];
    const out: MediaRef[] = [];
    for (const m of jeu.medias) {
      const type = m.type ? MEDIA_MAP[m.type] : undefined;
      if (type && m.url) out.push({ type, url: m.url, region: m.region ?? null });
    }
    return out;
  },

  getRateLimitState(): RateLimitState {
    return lastQuota;
  },
};

export function __resetScreenScraperCache(): void {
  cache.clear();
  lastQuota = { provider: 'screenscraper', remaining: null, limit: null, blockedUntil: null };
}
