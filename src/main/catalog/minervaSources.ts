// Config mapping IGDB platforms to Minerva Archive torrent collections. Minerva hosts one
// static .torrent per Redump console set at a versioned assets path:
//   https://minerva-archive.org/assets/Minerva_Myrient_<ver>/Minerva_Myrient - <collection>.torrent
// The collection name is "Redump - <Manufacturer> - <Platform>". Verified live 2026-07-07
// (v0.3). To add a console, paste one { platformId, collection } row. See minerva.ts for
// the provider; downloads reuse the bundled aria2 torrent engine (aria2/torrent.ts).
import { MinervaStorageProvider } from '../storage/providers/minerva';
import { getSystem } from '../db/repositories/systemsRepo';
import { getCustomMinervaSourcesForPlatform } from './customSources';
import { IGDB_PLATFORM_BY_SLUG } from '@shared/contracts/catalog';

const ASSETS_BASE = 'https://minerva-archive.org/assets/';
/** Pinned Minerva assets version (the torrents live under Minerva_Myrient_<ver>/). */
export const MINERVA_VERSION = 'v0.3';

export interface MinervaSource {
  platformId: number;
  /** "Redump - <Manufacturer> - <Platform>" - the collection torrent's name. */
  collection: string;
  /** Per-game member extensions (Redump sets are per-game .zip wrapping a disc image). */
  extensions: string[];
}

// Sony + Microsoft Redump sets confirmed present on Minerva v0.3. GameCube/Wii use a
// different (absent) naming and are intentionally omitted. PS3 IS wired now: its Redump
// discs are encrypted, but the download pipeline auto-decrypts them (ps3decrypt.ts) after
// unzip, so RPCS3 can boot them.
export const MINERVA_SOURCES: MinervaSource[] = [
  { platformId: 38, collection: 'Redump - Sony - PlayStation Portable', extensions: ['zip'] }, // PSP
  { platformId: 7, collection: 'Redump - Sony - PlayStation', extensions: ['zip'] }, // PS1
  { platformId: 8, collection: 'Redump - Sony - PlayStation 2', extensions: ['zip'] }, // PS2
  { platformId: 9, collection: 'Redump - Sony - PlayStation 3', extensions: ['zip'] }, // PS3 (auto-decrypted)
  { platformId: 11, collection: 'Redump - Microsoft - Xbox', extensions: ['zip'] }, // Xbox
  { platformId: 12, collection: 'Redump - Microsoft - Xbox 360', extensions: ['zip'] }, // Xbox 360
  // No-Intro cartridge sets (per-game .zip wrapping the ROM → extract). Decrypted DS so
  // melonDS boots directly. These cover all mainline Pokémon (DS: Diamond→B2W2, GBA: Ruby→Emerald).
  { platformId: 20, collection: 'No-Intro - Nintendo - Nintendo DS (Decrypted)', extensions: ['zip'] }, // DS
  { platformId: 24, collection: 'No-Intro - Nintendo - Game Boy Advance', extensions: ['zip'] }, // GBA
  // NES: the Headered No-Intro set (per-game .zip wrapping a .nes with the 16-byte iNES
  // header emulators expect). Verified live against Minerva v0.3.
  { platformId: 18, collection: 'No-Intro - Nintendo - Nintendo Entertainment System (Headered)', extensions: ['zip'] }, // NES
  // 3DS: the DECRYPTED set (2186 per-game .zip wrapping a .3ds), so Azahar boots them
  // without console keys. Verified live 2026-07-21 against Minerva v0.3.
  { platformId: 37, collection: 'No-Intro - Nintendo - Nintendo 3DS (Decrypted)', extensions: ['zip'] }, // 3DS
  // Wii U (41): the Digital (CDN) set - per-title .zip of raw CDN content. NOTE: these
  // are ENCRYPTED CDN dumps; Cemu needs them unpacked with CDecrypt first (a
  // decrypt/unpack step not yet in the download pipeline), so the download succeeds but
  // the title will not boot until that step is added. Wired for availability now.
  { platformId: 41, collection: 'No-Intro - Nintendo - Wii U (Digital) (CDN)', extensions: ['zip'] }, // Wii U
];

export function minervaTorrentUrl(collection: string): string {
  return `${ASSETS_BASE}Minerva_Myrient_${MINERVA_VERSION}/` + encodeURIComponent(`Minerva_Myrient - ${collection}.torrent`);
}

/** The `source` string recorded on game_files for a Minerva-acquired file. */
export function minervaSourceString(collection: string): string {
  return `minerva:${collection}`;
}

const providerCache = new Map<string, MinervaStorageProvider>();
export function getMinervaProvider(collection: string): MinervaStorageProvider {
  let provider = providerCache.get(collection);
  if (!provider) {
    const src = MINERVA_SOURCES.find((s) => s.collection === collection);
    provider = new MinervaStorageProvider(collection, minervaTorrentUrl(collection), {
      extensions: src?.extensions ?? ['zip'],
    });
    providerCache.set(collection, provider);
  }
  return provider;
}

export function getMinervaSourcesForPlatform(platformId: number): MinervaSource[] {
  return [
    ...MINERVA_SOURCES.filter((s) => s.platformId === platformId),
    ...getCustomMinervaSourcesForPlatform(platformId), // user-added sources (Settings → Sources)
  ];
}

export function getMinervaSourcesForSystem(systemId: number): MinervaSource[] {
  const system = getSystem(systemId);
  if (!system) return [];
  const platformId = IGDB_PLATFORM_BY_SLUG[system.slug];
  return platformId == null ? [] : getMinervaSourcesForPlatform(platformId);
}

/** Resolves the provider for a `minerva:<collection>` source string; null for other sources. */
export function getMinervaProviderForSource(source: string): MinervaStorageProvider | null {
  const prefix = 'minerva:';
  return source.startsWith(prefix) ? getMinervaProvider(source.slice(prefix.length)) : null;
}
