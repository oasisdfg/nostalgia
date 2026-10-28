import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, link, copyFile, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { RecompGameReady, RecompManifest } from '@shared/contracts/recomps';
import type { RecompInstallRow } from '../db/repositories/recompsRepo';
import { getInstall, upsertInstall, listCandidateFiles } from '../db/repositories/recompsRepo';
import { setHashes, getPrimaryFileForGame } from '../db/repositories/gameFilesRepo';
import { getGame } from '../db/repositories/gamesRepo';
import { hashFile } from '../storage/hashing';
import { ensureCached } from '../launch/launcher';
import { listManifests, getManifest } from './registry';
import { joinInside } from './paths';

/**
 * Binds each port to the user's own copy of its original game, by hash. Never downloads
 * anything: it only looks at files already in the library.
 */

// Hash on demand only ROM-sized files (N64 carts top out at 64 MB). Disc images run to GBs
// and would stall startup; those link manually.
const HASH_LIMIT_BYTES = 256 * 1024 * 1024;

interface Hashes {
  crc32: string | null;
  md5: string | null;
  sha1: string | null;
}

/** Per-run memo of on-disk hashes, keyed by path + size + mtime. */
const memo = new Map<string, Hashes[]>();
/** recompId → whether the linked game has an accepted file (feeds RecompDTO.fileVerified). */
const verified = new Map<string, boolean>();
/** recompId → the matching game_files.id, used for reveal / copy / {romPath}. */
const matchedFile = new Map<string, number>();
/** recompId → whether the user's PICKED file is a known-good dump. */
const pickedVerified = new Map<string, boolean>();

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function hashBuffer(buf: Buffer): Hashes {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return {
    crc32: ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0'),
    md5: createHash('md5').update(buf).digest('hex'),
    sha1: createHash('sha1').update(buf).digest('hex'),
  };
}

/**
 * N64 ROMs circulate in three byte orders; published hashes are for big-endian .z64.
 * Returns the .z64 form of a byte-swapped (.v64) or little-endian (.n64) dump, else null.
 */
function toZ64(buf: Buffer): Buffer | null {
  if (buf.length < 4 || buf.length % 4 !== 0) return null;
  const magic = buf.readUInt32BE(0);
  if (magic === 0x37804012) return Buffer.from(buf).swap16(); // .v64
  if (magic === 0x40123780) return Buffer.from(buf).swap32(); // .n64
  return null;
}

/** Every hash form of an on-disk file worth comparing (raw, plus .z64 for N64). */
async function diskHashes(path: string, systemSlug: string): Promise<Hashes[] | null> {
  const st = await stat(path).catch(() => null);
  if (!st || !st.isFile() || st.size > HASH_LIMIT_BYTES) return null;
  const key = `${path}\u0000${st.size}\u0000${st.mtimeMs}`;
  const hit = memo.get(key);
  if (hit) return hit;
  let out: Hashes[];
  if (systemSlug === 'n64') {
    const buf = await readFile(path);
    const z64 = toZ64(buf);
    out = z64 ? [hashBuffer(buf), hashBuffer(z64)] : [hashBuffer(buf)];
  } else {
    out = [await hashFile(path)];
  }
  memo.set(key, out);
  return out;
}

function accepts(manifest: RecompManifest, h: Hashes): boolean {
  return manifest.gameFile.accepted.some(
    (a) =>
      (a.sha1 && h.sha1?.toLowerCase() === a.sha1) ||
      (a.md5 && h.md5?.toLowerCase() === a.md5) ||
      (a.crc32 && h.crc32?.toLowerCase() === a.crc32),
  );
}

type Candidate = ReturnType<typeof listCandidateFiles>[number];

/** Exact-size match for an image too big to hash on the fly (links, but doesn't verify). */
function sizeMatches(manifest: RecompManifest, f: Candidate): boolean {
  return f.size_bytes != null && manifest.gameFile.accepted.some((a) => a.size != null && a.size === f.size_bytes);
}

/**
 * How a library file matches the port: 'hash' (a known-good dump), 'size' (same size as a
 * known-good disc image; the port's own installer checks the hash), or null.
 */
async function fileMatches(manifest: RecompManifest, f: Candidate): Promise<'hash' | 'size' | null> {
  if (accepts(manifest, f)) return 'hash';
  if (f.local_path) {
    const forms = await diskHashes(f.local_path, manifest.gameFile.systemSlug);
    if (forms) {
      // A file adopted from the games folder has no hashes yet - record the raw ones.
      if (!f.sha1 && !f.md5 && !f.crc32) setHashes(f.id, forms[0], 'post_download');
      if (forms.some((h) => accepts(manifest, h))) return 'hash';
    }
  }
  return sizeMatches(manifest, f) ? 'size' : null;
}

async function evaluate(manifest: RecompManifest, candidates: Candidate[]): Promise<void> {
  const row = getInstall(manifest.id);
  const linked = row?.linked_game_id ?? null;
  // An existing link (manual or earlier auto) is never overridden - only verified.
  const pool = linked != null ? candidates.filter((c) => c.game_id === linked) : candidates;
  let match: Candidate | null = null;
  let how: 'hash' | 'size' | null = null;
  for (const c of pool) {
    const m = await fileMatches(manifest, c).catch(() => null);
    if (m === 'hash' || (m === 'size' && !match)) {
      match = c;
      how = m;
      if (m === 'hash') break; // a verified dump beats a size match
    }
  }
  if (match) {
    matchedFile.set(manifest.id, match.id);
    if (linked == null) upsertInstall(manifest.id, { linked_game_id: match.game_id });
  } else {
    matchedFile.delete(manifest.id);
  }
  verified.set(manifest.id, how === 'hash');
}

let running: Promise<void> | null = null;

/** Links every unlinked port to a matching library file. Idempotent; concurrent calls share one run. */
export function autoLink(): Promise<void> {
  if (!running) {
    running = (async () => {
      const bySlug = new Map<string, Candidate[]>();
      for (const m of listManifests()) {
        const slug = m.gameFile.systemSlug;
        if (!bySlug.has(slug)) bySlug.set(slug, listCandidateFiles(slug));
        await evaluate(m, bySlug.get(slug)!);
        await evaluatePicked(m, getInstall(m.id)).catch(() => undefined);
      }
    })().finally(() => {
      running = null;
    });
  }
  return running;
}

/** The user's explicit pick from their library (any game on the port's system). */
export async function linkManually(recompId: string, gameId: number): Promise<void> {
  const manifest = getManifest(recompId);
  if (!manifest) throw new Error('Unknown port.');
  const game = getGame(gameId);
  if (!game) throw new Error('Game not found.');
  upsertInstall(recompId, { linked_game_id: gameId, file_delivered: 0 });
  await evaluate(manifest, listCandidateFiles(manifest.gameFile.systemSlug));
}

export function unlink(recompId: string): void {
  upsertInstall(recompId, { linked_game_id: null, file_delivered: 0 });
  verified.set(recompId, false);
  matchedFile.delete(recompId);
}

/**
 * Checks files the user picked through the OS dialog. A file small enough to hash can be a
 * known-good dump; a folder, an oversized image or an unknown dump is unverified (an exact
 * size match still only counts as unverified - the port checks the rest).
 */
async function evaluatePicked(manifest: RecompManifest, row: RecompInstallRow | undefined): Promise<void> {
  const path = row?.picked_path;
  pickedVerified.delete(manifest.id);
  if (!path) return;
  const st = await stat(path).catch(() => null);
  if (!st?.isFile()) return;
  const forms = await diskHashes(path, manifest.gameFile.systemSlug);
  pickedVerified.set(manifest.id, !!forms && forms.some((h) => accepts(manifest, h)));
}

/** Stores the user's picked files/folder (opaque, verbatim) and checks them. */
export async function setPicked(recompId: string, path: string): Promise<void> {
  const manifest = getManifest(recompId);
  if (!manifest) throw new Error('Unknown port.');
  const row = upsertInstall(recompId, { picked_path: path, file_delivered: 0 });
  await evaluatePicked(manifest, row);
}

export function clearPicked(recompId: string): void {
  upsertInstall(recompId, { picked_path: null, file_delivered: 0 });
  pickedVerified.delete(recompId);
}

/** The user's copy for this port: a linked library game wins over picked files. */
export function gameReady(recompId: string, row: RecompInstallRow | undefined): RecompGameReady {
  if (row?.linked_game_id != null) return verified.get(recompId) ? 'verified' : 'unverified';
  if (row?.picked_path && existsSync(row.picked_path)) return pickedVerified.get(recompId) ? 'verified' : 'unverified';
  return 'missing';
}

/** The game file handed to the port: the hash-matched one, else the game's primary file. */
export function fileForPort(recompId: string, gameId: number): number | null {
  return matchedFile.get(recompId) ?? getPrimaryFileForGame(gameId)?.id ?? null;
}

/**
 * On-disk path of the user's copy, in order: the matched library file (fetched into the
 * cache if needed), then the picked files/folder. Throws a human message when there's none.
 */
export async function resolveGamePath(recompId: string): Promise<string> {
  const manifest = getManifest(recompId);
  const row = getInstall(recompId);
  if (!manifest) throw new Error('Unknown port.');
  if (row?.linked_game_id != null) {
    const fileId = fileForPort(recompId, row.linked_game_id);
    if (fileId == null) throw new Error('The linked game has no file yet.');
    return ensureCached(fileId);
  }
  if (row?.picked_path && existsSync(row.picked_path)) return row.picked_path;
  throw new Error(`Link your copy of ${manifest.originalTitle} first.`);
}

/**
 * Gets the game file to the port before launch. 'argv' resolves at launch ({romPath});
 * 'in-app' is handled by the user in the port's own picker; 'copy' places the file into
 * the install (hardlink on the same volume, copy across volumes). Idempotent.
 */
export async function deliverFile(recompId: string): Promise<void> {
  const manifest = getManifest(recompId);
  const row = getInstall(recompId);
  if (!manifest || !row?.install_dir) return;
  if (manifest.gameFile.delivery !== 'copy' || !manifest.gameFile.placePath) return;
  const src = await resolveGamePath(recompId);
  const dest = joinInside(row.install_dir, manifest.gameFile.placePath);
  const [s, d] = await Promise.all([stat(src), stat(dest).catch(() => null)]);
  if (s.isDirectory()) {
    // A picked folder (e.g. a PSP EBOOT + PSP_GAME tree): copy it in once.
    if (!d) await cp(src, dest, { recursive: true });
  } else if (!d || d.size !== s.size) {
    await mkdir(dirname(dest), { recursive: true });
    await rm(dest, { force: true }); // a stale/partial copy from an earlier attempt
    try {
      await link(src, dest);
    } catch {
      await copyFile(src, dest); // different volume (EXDEV) or no hardlink support
    }
  }
  upsertInstall(recompId, { file_delivered: 1 });
}
