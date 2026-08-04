// Reads a PS3 title's SERIAL (PARAM.SFO's TITLE_ID, e.g. "BCUS98111") from a dump.
//
// The serial is the keystone for every RPCS3 integration: the compatibility list is keyed
// by it, per-game configs live at config/custom_configs/config_<SERIAL>.yml, and patch.yml
// lists it verbatim. Two dump shapes are supported:
//   - a folder dump  -> <root>/PS3_GAME/PARAM.SFO (also handles a root that IS PS3_GAME)
//   - a disc image   -> an ISO9660 walk to /PS3_GAME/PARAM.SFO
// Everything is best-effort: an unreadable or non-PS3 image yields null rather than
// throwing, because a missing serial degrades to "no reminder", never to a failed launch.
// MAIN PROCESS ONLY.
import { open, stat, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';

const SECTOR = 2048;
/** ISO9660 Primary Volume Descriptor lives at sector 16. */
const PVD_SECTOR = 16;

// ── PARAM.SFO ──────────────────────────────────────────────────────────────────────
// Header: magic "\0PSF", version, key-table start, data-table start, entry count. Then
// one 16-byte index entry per key. Format reference: PS3 Developer wiki (PARAM.SFO).
const SFO_MAGIC = 0x46535000; // "\0PSF" read as LE u32

/** Parses a PARAM.SFO buffer into its key/value pairs. Returns null if not an SFO. */
export function parseParamSfo(buf: Buffer): Map<string, string | number> | null {
  if (buf.length < 20 || buf.readUInt32LE(0) !== SFO_MAGIC) return null;
  const keyTable = buf.readUInt32LE(8);
  const dataTable = buf.readUInt32LE(12);
  const count = buf.readUInt32LE(16);
  // A corrupt header can claim a huge entry count; bound it against the buffer.
  if (count > 4096 || 20 + count * 16 > buf.length) return null;

  const out = new Map<string, string | number>();
  for (let i = 0; i < count; i++) {
    const e = 20 + i * 16;
    const keyOff = keyTable + buf.readUInt16LE(e);
    const fmt = buf.readUInt16LE(e + 2);
    const dataLen = buf.readUInt32LE(e + 4);
    const dataOff = dataTable + buf.readUInt32LE(e + 12);
    if (keyOff >= buf.length || dataOff + dataLen > buf.length) continue;

    const keyEnd = buf.indexOf(0, keyOff);
    const key = buf.toString('utf8', keyOff, keyEnd === -1 ? buf.length : keyEnd);
    if (!key) continue;

    if (fmt === 0x0404) {
      if (dataLen >= 4) out.set(key, buf.readUInt32LE(dataOff));
    } else {
      // utf8, with (0x0204) or without (0x0004) a trailing NUL inside data_len.
      const raw = buf.subarray(dataOff, dataOff + dataLen);
      const nul = raw.indexOf(0);
      out.set(key, raw.toString('utf8', 0, nul === -1 ? raw.length : nul));
    }
  }
  return out;
}

/** A serial is 4 letters + 5 digits (BCUS98111, NPUA80490). Anything else is not one. */
export function isPs3Serial(s: string): boolean {
  return /^[A-Z]{4}[0-9]{5}$/.test(s);
}

function serialFromSfo(buf: Buffer): string | null {
  const sfo = parseParamSfo(buf);
  const raw = sfo?.get('TITLE_ID');
  if (typeof raw !== 'string') return null;
  // Some SFOs carry a hyphenated form (BCUS-98111); the canonical key drops it.
  const serial = raw.replace(/-/g, '').toUpperCase().trim();
  return isPs3Serial(serial) ? serial : null;
}

// ── ISO9660 walk ───────────────────────────────────────────────────────────────────

interface DirRecord {
  name: string;
  lba: number;
  length: number;
  isDir: boolean;
}

/** Parses the directory records packed into one directory's extent. */
function parseDirRecords(buf: Buffer): DirRecord[] {
  const out: DirRecord[] = [];
  let p = 0;
  while (p < buf.length) {
    const len = buf[p];
    // A zero length means "no more records in this sector"; skip to the next one.
    if (len === 0) {
      const next = (Math.floor(p / SECTOR) + 1) * SECTOR;
      if (next <= p || next >= buf.length) break;
      p = next;
      continue;
    }
    if (p + len > buf.length || len < 33) break;
    const nameLen = buf[p + 32];
    if (p + 33 + nameLen > buf.length) break;
    // Strip the ";1" version suffix ISO9660 appends to file identifiers.
    const name = buf.toString('latin1', p + 33, p + 33 + nameLen).split(';')[0].toUpperCase();
    out.push({
      name,
      lba: buf.readUInt32LE(p + 2),
      length: buf.readUInt32LE(p + 10),
      isDir: (buf[p + 25] & 0x02) !== 0,
    });
    p += len;
  }
  return out;
}

async function readAt(fh: FileHandle, offset: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, offset);
  return bytesRead === length ? buf : buf.subarray(0, bytesRead);
}

/** Reads an ISO9660 image's ROOT directory listing, or null if it has no PVD. */
async function readRootRecords(fh: FileHandle): Promise<DirRecord[] | null> {
  const pvd = await readAt(fh, PVD_SECTOR * SECTOR, SECTOR);
  // Type 1 (primary) + "CD001" identifier.
  if (pvd.length < SECTOR || pvd[0] !== 1 || pvd.toString('latin1', 1, 6) !== 'CD001') return null;
  // Root directory record is embedded at offset 156 of the PVD.
  const lba = pvd.readUInt32LE(156 + 2);
  const len = pvd.readUInt32LE(156 + 10);
  if (!len || len > 8 * 1024 * 1024) return null;
  return parseDirRecords(await readAt(fh, lba * SECTOR, len));
}

/**
 * Walks an ISO9660 image to /PS3_GAME/PARAM.SFO and returns its bytes.
 * Returns null when the image has no ISO9660 PVD or no such path (e.g. the region is
 * encrypted, or this simply isn't a PS3 disc).
 */
async function readParamSfoFromIso(fh: FileHandle): Promise<Buffer | null> {
  const pvd = await readAt(fh, PVD_SECTOR * SECTOR, SECTOR);
  // Type 1 (primary) + "CD001" identifier.
  if (pvd.length < SECTOR || pvd[0] !== 1 || pvd.toString('latin1', 1, 6) !== 'CD001') return null;

  // Root directory record is embedded at offset 156 of the PVD.
  let dirLba = pvd.readUInt32LE(156 + 2);
  let dirLen = pvd.readUInt32LE(156 + 10);

  for (const segment of ['PS3_GAME', 'PARAM.SFO']) {
    if (!dirLen || dirLen > 8 * 1024 * 1024) return null;
    const records = parseDirRecords(await readAt(fh, dirLba * SECTOR, dirLen));
    const hit = records.find((r) => r.name === segment);
    if (!hit) return null;
    dirLba = hit.lba;
    dirLen = hit.length;
    if (segment === 'PARAM.SFO') {
      if (hit.isDir || !dirLen || dirLen > 1024 * 1024) return null;
      return readAt(fh, dirLba * SECTOR, dirLen);
    }
    if (!hit.isDir) return null;
  }
  return null;
}

// ── public entry points ────────────────────────────────────────────────────────────

/** A disc image's console, identified from its root directory layout. */
export type DiscPlatform = 'ps3' | 'psp' | 'ps2' | 'ps1';

/**
 * Positively identifies a disc image's console, or null when it cannot be determined.
 *
 * Deliberately conservative: it reports a platform ONLY on an unambiguous marker in the
 * root directory, and null for everything else. Callers use it to reject a *confirmed*
 * mismatch (a PSP UMD dump filed under PS3), never to require a positive match - a PS3
 * disc whose structures sit in an encrypted region, or any layout not listed here, must
 * fall through as "unknown" rather than be wrongly rejected.
 */
export async function detectDiscPlatform(isoPath: string): Promise<DiscPlatform | null> {
  try {
    const fh = await open(isoPath, 'r');
    try {
      const records = await readRootRecords(fh);
      if (!records) return null;
      const names = new Set(records.map((r) => r.name));
      if (names.has('PS3_GAME')) return 'ps3';
      // A PSP UMD dump: PSP_GAME + UMD_DATA.BIN at the root.
      if (names.has('PSP_GAME') || names.has('UMD_DATA.BIN')) return 'psp';
      // PS2/PS1 discs carry a SYSTEM.CNF naming their boot executable; the BOOT2 key is
      // PS2-only, plain BOOT is PS1. Read it rather than guessing from the extension.
      const cnf = records.find((r) => r.name === 'SYSTEM.CNF');
      if (cnf && cnf.length > 0 && cnf.length < 64 * 1024) {
        const text = (await readAt(fh, cnf.lba * SECTOR, cnf.length)).toString('latin1');
        if (/BOOT2\s*=/i.test(text)) return 'ps2';
        if (/^\s*BOOT\s*=/im.test(text)) return 'ps1';
      }
      return null;
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

/**
 * Best-effort serial for a launch path. Accepts either a folder dump (or any file inside
 * one, such as the EBOOT.BIN the extractor picks as the launch path) or a disc image.
 * Never throws - callers treat null as "unknown, skip the RPCS3 preflight".
 */
export async function readPs3Serial(launchPath: string): Promise<string | null> {
  try {
    const st = await stat(launchPath);

    if (st.isDirectory()) return readSerialFromDir(launchPath);

    // A file: first try it as a disc image. A PSP UMD image also has an ISO9660 PVD but no
    // PS3_GAME dir, so it correctly falls through to null rather than a bogus serial.
    const fh = await open(launchPath, 'r');
    try {
      const sfo = await readParamSfoFromIso(fh);
      if (sfo) return serialFromSfo(sfo);
    } finally {
      await fh.close();
    }

    // Otherwise it may be a file INSIDE a folder dump - the launch path for those is
    // <root>/PS3_GAME/USRDIR/EBOOT.BIN. Only walk up when the path actually sits under a
    // PS3_GAME directory, so a stray .iso doesn't probe unrelated parent folders.
    const segments = launchPath.split(/[\\/]/);
    const idx = segments.findIndex((s) => s.toUpperCase() === 'PS3_GAME');
    if (idx > 0) return readSerialFromDir(segments.slice(0, idx).join('/'));
    return null;
  } catch {
    return null;
  }
}

/** Reads PARAM.SFO from a folder dump root, tolerating a root that already IS PS3_GAME. */
async function readSerialFromDir(dir: string): Promise<string | null> {
  for (const rel of [join('PS3_GAME', 'PARAM.SFO'), 'PARAM.SFO']) {
    try {
      const fh = await open(join(dir, rel), 'r');
      try {
        const serial = serialFromSfo(await readAt(fh, 0, Math.min((await fh.stat()).size, 1024 * 1024)));
        if (serial) return serial;
      } finally {
        await fh.close();
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}
