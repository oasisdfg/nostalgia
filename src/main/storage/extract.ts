// Extracts a per-game .zip (Redump disc images for Xbox 360 / Xbox / PS2 / PSX / PSP)
// into launch-ready files. Those emulators can't read a zip, so after a verified
// download the DownloadManager unzips the disc image and launches the extracted file.
// The .zip is deleted afterwards (settings: extract-on-download, keep-only-image).
//
// Inner directory structure is PRESERVED. Packed disc images are flat so this is a no-op
// for them, but a folder-based title (a PS3 dump: PS3_GAME/USRDIR/EBOOT.BIN + data) is
// unbootable once flattened - RPCS3 needs the tree intact and launches the EBOOT.
// MAIN PROCESS ONLY. Reads the already-downloaded zip from local disk (no network).
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat as fsStat } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface ExtractResult {
  /** The file the emulator should open ({romPath} → cache_entries.local_path). */
  launchPath: string;
  /** Sum of extracted file sizes (accurate disk/LRU accounting). */
  totalBytes: number;
  /** For a multi-file game: the dedicated folder to remove wholesale on eviction/removal.
   *  NULL when the zip held a single file extracted flat next to its siblings. */
  extractDir: string | null;
}

// Launch-file preference. A .cue/.gdi/.m3u references sibling data tracks, so it must
// win over the raw .bin/.img it points at. Otherwise the single disc image wins.
const LAUNCH_PRIORITY = ['m3u', 'cue', 'gdi', 'iso', 'chd', 'cso', 'pbp', 'nrg', '3ds', 'cia', 'img', 'bin'];

/**
 * A folder-based title (a PS3 disc/PSN dump, not a packed disc image) boots from its
 * executable inside the tree, not from any disc-image file. RPCS3 takes the path to
 * EBOOT.BIN directly, so that must outrank LAUNCH_PRIORITY - such a tree also contains
 * plenty of .bin/.img data files that would otherwise win and fail to boot.
 */
function pickBootFile(paths: string[]): string | null {
  const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();
  // Prefer the canonical PS3_GAME/USRDIR/EBOOT.BIN over any other EBOOT.BIN in the tree
  // (some dumps carry extra ones under install/ or patch folders).
  return (
    paths.find((p) => norm(p).endsWith('/ps3_game/usrdir/eboot.bin')) ??
    paths.find((p) => norm(p).endsWith('/eboot.bin')) ??
    null
  );
}

function pickLaunch(paths: string[]): string {
  const boot = pickBootFile(paths);
  if (boot) return boot;
  for (const ext of LAUNCH_PRIORITY) {
    const hit = paths.find((p) => extname(p).slice(1).toLowerCase() === ext);
    if (hit) return hit;
  }
  return paths[0];
}

/**
 * Maps an archive entry name to a SAFE relative path, preserving directory structure.
 * Folder-based titles (PS3_GAME/USRDIR/...) are destroyed by flattening, so inner paths
 * are kept - but a crafted archive must never escape the target dir, so `..` segments,
 * absolute paths, and Windows drive/UNC prefixes are rejected outright.
 */
function safeEntryPath(entryName: string): string | null {
  const parts = entryName
    .replace(/\\/g, '/')
    .split('/')
    .filter((seg) => seg !== '' && seg !== '.');
  if (parts.length === 0) return null;
  if (parts.some((seg) => seg === '..')) return null;
  // Absolute (`/foo`), drive-relative (`C:foo`) or UNC-ish first segments.
  if (/^[a-zA-Z]:/.test(parts[0]) || entryName.startsWith('/') || entryName.startsWith('\\')) return null;
  return join(...parts);
}

/** Reads every entry name up front (lazyEntries) so we know single-vs-multi before writing. */
function collectEntries(zip: ZipFile): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: Entry[] = [];
    zip.on('entry', (entry) => {
      if (!entry.fileName.endsWith('/')) entries.push(entry); // skip directory records
      zip.readEntry();
    });
    zip.on('end', () => resolve(entries));
    zip.on('error', reject);
    zip.readEntry();
  });
}

function openZip(zipPath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err || !zip) reject(err ?? new Error('failed to open zip'));
      else resolve(zip);
    });
  });
}

function openEntryStream(zip: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) reject(err ?? new Error('failed to open entry stream'));
      else resolve(stream);
    });
  });
}

/**
 * Extracts `zipPath`'s contents. A single inner file is written flat beside the zip
 * (`<dir>/<inner>`); multiple inner files (e.g. a PSX .cue + .bin set) go into a
 * dedicated `<dir>/<zipname-without-ext>/` folder so they stay grouped for cleanup.
 * `onProgress(done,total)` reports uncompressed bytes written.
 */
export async function extractGameZip(
  zipPath: string,
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<ExtractResult> {
  const zip = await openZip(zipPath);
  const written: string[] = [];
  const multiDir = join(dirname(zipPath), basename(zipPath, extname(zipPath)));
  try {
    const entries = await collectEntries(zip);
    if (entries.length === 0) throw new Error('zip contained no files to extract');

    // Resolve every entry to a safe relative path up front so a malformed archive fails
    // before anything is written.
    const planned = entries.map((entry) => {
      const relPath = safeEntryPath(entry.fileName);
      if (!relPath) throw new Error(`refusing unsafe archive entry: ${entry.fileName}`);
      return { entry, relPath };
    });

    // A dedicated folder is needed whenever the contents are more than one flat file -
    // either several entries (a PSX .cue + .bin set) or a single nested one - so the tree
    // stays grouped for eviction/removal. Only a lone top-level file goes flat.
    const nested = planned.some((p) => p.relPath !== basename(p.relPath));
    const multi = planned.length > 1 || nested;
    const baseDir = dirname(zipPath);
    const targetDir = multi ? multiDir : baseDir;
    if (multi) await mkdir(targetDir, { recursive: true });

    const totalUncompressed = entries.reduce((n, e) => n + (e.uncompressedSize || 0), 0);
    let done = 0;

    for (const { entry, relPath } of planned) {
      if (opts.signal?.aborted) throw new DOMException('extraction aborted', 'AbortError');
      // Preserve the inner directory structure: folder-based titles (PS3_GAME/USRDIR/...)
      // do not boot once flattened. safeEntryPath already rejected any escaping path.
      const outPath = join(targetDir, relPath);
      await mkdir(dirname(outPath), { recursive: true });
      const stream = await openEntryStream(zip, entry);
      const counter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          done += chunk.length;
          opts.onProgress?.(done, totalUncompressed);
          cb(null, chunk);
        },
      });
      await pipeline(stream, counter, createWriteStream(outPath), { signal: opts.signal });
      written.push(outPath);
    }

    const totalBytes = await written.reduce(
      async (accP, p) => (await accP) + (await fsStat(p).then((s) => s.size).catch(() => 0)),
      Promise.resolve(0),
    );
    return { launchPath: pickLaunch(written), totalBytes, extractDir: multi ? targetDir : null };
  } catch (err) {
    // Best-effort cleanup of a partial extraction (flat files + the multi-file folder)
    // so a retry starts clean.
    await Promise.all(written.map((p) => rm(p, { force: true }).catch(() => undefined)));
    await rm(multiDir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  } finally {
    zip.close();
  }
}
