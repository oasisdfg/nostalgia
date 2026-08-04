// Imports the LaunchBox Games Database (gamesdb.launchbox-app.com/Metadata.zip) into the
// launchbox_* tables. The zip holds one ~500MB Metadata.xml with <Game>, <GameAlternateName>
// and <GameImage> records, so it is STREAM-parsed (saxes) straight out of the zip entry
// (yauzl) - never materialized. Only mapped consoles and displayed image types are kept.
// MAIN PROCESS ONLY. Settings-button triggered; a full refresh replaces the dataset.
import { app } from 'electron';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { SaxesParser } from 'saxes';
import * as lb from '../db/repositories/launchboxRepo';
import { IMPORTED_LAUNCHBOX_PLATFORMS } from './platformMap';
import { normalizeLbTitle } from './normalizeTitle';

const METADATA_URL = 'https://gamesdb.launchbox-app.com/Metadata.zip';
const BATCH = 4000;
// Only image types we render on a detail page (LaunchBox has ~30 types).
const WANTED_IMAGE_TYPES = new Set(['Clear Logo', 'Fanart - Background', 'Banner', 'Box - Front']);

export interface ImportProgress {
  phase: 'downloading' | 'importing' | 'done';
  /** downloading: fraction 0..1; importing: games processed so far. */
  received?: number;
  total?: number;
  games?: number;
}

function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err || !zip) reject(err ?? new Error('failed to open metadata zip'));
      else resolve(zip);
    });
  });
}

function findEntry(zip: ZipFile, name: string): Promise<Entry> {
  return new Promise((resolve, reject) => {
    zip.on('entry', (entry) => {
      if (entry.fileName === name) resolve(entry);
      else zip.readEntry();
    });
    zip.on('end', () => reject(new Error(`${name} not found in metadata zip`)));
    zip.on('error', reject);
    zip.readEntry();
  });
}

function openEntryStream(zip: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) reject(err ?? new Error('failed to open metadata entry'));
      else resolve(stream);
    });
  });
}

/** Downloads the zip to a temp file, reporting download progress. Returns the temp path. */
async function downloadZip(onProgress: (p: ImportProgress) => void, signal?: AbortSignal): Promise<string> {
  const dir = join(app.getPath('userData'), 'tmp');
  await mkdir(dir, { recursive: true });
  const dest = join(dir, 'launchbox-metadata.zip');
  const res = await fetch(METADATA_URL, { signal });
  if (!res.ok || !res.body) throw new Error(`metadata download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  let lastEmit = 0;
  const node = Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>);
  node.on('data', (c: Buffer) => {
    received += c.length;
    const now = Date.now();
    if (now - lastEmit > 250) {
      lastEmit = now;
      onProgress({ phase: 'downloading', received, total, ...(total ? { received: received / total, total: 1 } : {}) });
    }
  });
  await pipeline(node, createWriteStream(dest), { signal });
  return dest;
}

/**
 * Runs a full import. `onProgress` is throttled by the caller's cadence needs; this emits
 * on meaningful deltas. Returns the number of games imported.
 */
export async function importLaunchbox(
  onProgress: (p: ImportProgress) => void,
  signal?: AbortSignal,
): Promise<number> {
  const zipPath = await downloadZip(onProgress, signal);
  const zip = await openZip(zipPath);
  try {
    const entry = await findEntry(zip, 'Metadata.xml');
    const stream = await openEntryStream(zip, entry);

    lb.clearAll();

    // Parser state: a flat record (Game/GameAlternateName/GameImage) whose children are
    // leaf text fields. keptIds gates alt-names/images to games on a mapped platform.
    const keptIds = new Set<number>();
    let recordType: string | null = null;
    let record: Record<string, string> = {};
    let field: string | null = null;
    let text = '';

    const games: lb.LbGameRow[] = [];
    const alts: lb.LbAltRow[] = [];
    const images: lb.LbImageRow[] = [];
    let gameCount = 0;
    let lastEmit = 0;

    const num = (v: string | undefined): number | null => (v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null);

    const flushGames = (): void => {
      if (games.length) {
        lb.insertGames(games.splice(0));
      }
    };
    const flushAll = (): void => {
      flushGames();
      if (alts.length) lb.insertAltNames(alts.splice(0));
      if (images.length) lb.insertImages(images.splice(0));
    };

    const finishRecord = (): void => {
      if (recordType === 'Game') {
        const platform = record.Platform;
        const id = num(record.DatabaseID);
        if (id != null && platform && IMPORTED_LAUNCHBOX_PLATFORMS.has(platform)) {
          keptIds.add(id);
          games.push({
            database_id: id,
            title: record.Name ?? '',
            title_norm: normalizeLbTitle(record.Name ?? ''),
            platform,
            overview: record.Overview ?? null,
            release_date: record.ReleaseDate ?? (record.ReleaseYear ? `${record.ReleaseYear}` : null),
            genres: record.Genres || null,
            developer: record.Developer ?? null,
            publisher: record.Publisher ?? null,
            community_rating: num(record.CommunityRating),
            community_rating_count: num(record.CommunityRatingCount),
            esrb: record.ESRB ?? null,
            max_players: num(record.MaxPlayers),
            cooperative: record.Cooperative === 'true' ? 1 : 0,
            video_url: record.VideoURL ?? null,
            wikipedia_url: record.WikipediaURL ?? null,
          });
          gameCount++;
          if (games.length >= BATCH) flushGames();
          const now = Date.now();
          if (now - lastEmit > 250) {
            lastEmit = now;
            onProgress({ phase: 'importing', games: gameCount });
          }
        }
      } else if (recordType === 'GameAlternateName') {
        const id = num(record.DatabaseID);
        if (id != null && keptIds.has(id) && record.AlternateName) {
          alts.push({ database_id: id, name_norm: normalizeLbTitle(record.AlternateName) });
          if (alts.length >= BATCH) lb.insertAltNames(alts.splice(0));
        }
      } else if (recordType === 'GameImage') {
        const id = num(record.DatabaseID);
        if (id != null && keptIds.has(id) && record.Type && WANTED_IMAGE_TYPES.has(record.Type) && record.FileName) {
          images.push({ database_id: id, type: record.Type, file_name: record.FileName, region: record.Region ?? null });
          if (images.length >= BATCH) lb.insertImages(images.splice(0));
        }
      }
      recordType = null;
      record = {};
    };

    const parser = new SaxesParser();
    parser.on('opentag', (node) => {
      if (node.name === 'LaunchBox') return;
      if (recordType == null) {
        recordType = node.name;
        record = {};
      } else {
        field = node.name;
        text = '';
      }
    });
    parser.on('text', (t) => {
      if (field != null) text += t;
    });
    parser.on('closetag', (node) => {
      if (field != null && node.name === field) {
        record[field] = text;
        field = null;
        text = '';
      } else if (node.name === recordType) {
        finishRecord();
      }
    });

    let parseError: Error | null = null;
    parser.on('error', (e) => {
      parseError = e instanceof Error ? e : new Error(String(e));
    });

    const decoder = new StringDecoder('utf8');
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => {
        if (signal?.aborted) {
          reject(new Error('import aborted'));
          return;
        }
        parser.write(decoder.write(chunk));
        if (parseError) reject(parseError);
      });
      stream.on('end', () => {
        parser.write(decoder.end());
        parser.close();
        resolve();
      });
      stream.on('error', reject);
    });

    flushAll();
    lb.setMeta(gameCount);
    onProgress({ phase: 'done', games: gameCount });
    return gameCount;
  } finally {
    zip.close();
    await rm(zipPath, { force: true }).catch(() => undefined);
  }
}
