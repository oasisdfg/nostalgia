// PS3 Redump ISO layout + in-place sector decryption, in pure Node - no external binary.
//
// A Redump PS3 disc image is split into alternating PLAIN and ENCRYPTED sector regions. The
// very first sector carries the region table; everything between two plain ranges is
// encrypted with AES-128-CBC under the disc key, one 2048-byte sector at a time, with the
// sector number as the IV. Algorithm verified byte-for-byte against the reference
// implementation (13xforever/ps3-disc-dumper, Ps3DiscDumper/Decrypter.cs) and validated
// end-to-end against IRD file hashes. MAIN PROCESS ONLY.
import { createDecipheriv, createCipheriv, createHash } from 'node:crypto';
import { open, type FileHandle } from 'node:fs/promises';

export const SECTOR = 2048;

export interface SectorRange {
  /** First sector, inclusive. */
  start: number;
  /** Last sector, inclusive. */
  end: number;
}

/**
 * Sector IV: the sector number big-endian in the LAST 8 bytes, leading 8 bytes zero
 * (reference: Decrypter.GetSectorIV).
 */
export function sectorIv(sector: number): Buffer {
  const iv = Buffer.alloc(16);
  iv.writeBigUInt64BE(BigInt(sector), 8);
  return iv;
}

/**
 * Reads the region table from sector 0: a big-endian count of PLAIN regions followed by
 * (start, end) sector pairs from offset 0x08. Returns the plain ranges; the gaps between
 * them are the encrypted regions. A table with a nonsense count means this isn't a
 * Redump-style PS3 image, and callers treat that as "nothing to decrypt".
 */
export async function readPlainRegions(fh: FileHandle): Promise<SectorRange[] | null> {
  const head = Buffer.alloc(128);
  await fh.read(head, 0, head.length, 0);
  const count = head.readUInt32BE(0);
  if (count === 0 || count > 15) return null;
  const out: SectorRange[] = [];
  for (let i = 0; i < count; i++) {
    const start = head.readUInt32BE(8 + i * 8);
    const end = head.readUInt32BE(12 + i * 8);
    if (end < start) return null;
    out.push({ start, end });
  }
  return out;
}

/** The encrypted sector ranges = the gaps between consecutive plain regions. */
export function encryptedRanges(plain: SectorRange[]): SectorRange[] {
  const out: SectorRange[] = [];
  for (let i = 0; i < plain.length - 1; i++) {
    const start = plain[i].end + 1;
    const end = plain[i + 1].start - 1;
    if (end >= start) out.push({ start, end });
  }
  return out;
}

/** One AES pass over the encrypted regions. `decrypt: false` is the inverse (re-encrypt). */
export interface TransformStep {
  key: Buffer;
  decrypt: boolean;
}

/** Transforms one sector: `decrypt` false re-ENCRYPTS (used to undo a wrong-key pass). */
function transformSector(buf: Buffer, off: number, sector: number, key: Buffer, decrypt: boolean): void {
  const iv = sectorIv(sector);
  const c = decrypt ? createDecipheriv('aes-128-cbc', key, iv) : createCipheriv('aes-128-cbc', key, iv);
  c.setAutoPadding(false);
  const block = buf.subarray(off, off + SECTOR);
  Buffer.concat([c.update(block), c.final()]).copy(buf, off);
}

/**
 * Rewrites every sector of `ranges` in place. Reads/writes in large chunks so a 35 GB disc
 * isn't 18 million syscalls. `decrypt: false` applies the inverse transform, which is how a
 * disc mangled by a wrong-key decrypt pass is put back before being decrypted properly.
 */
export async function transformRangesChain(
  isoPath: string,
  chain: TransformStep[],
  ranges: SectorRange[],
  onProgress?: (fraction: number) => void,
): Promise<void> {
  for (let i = 0; i < chain.length; i++) {
    await transformRanges(isoPath, chain[i].key, ranges, {
      decrypt: chain[i].decrypt,
      onProgress: onProgress && ((f) => onProgress((i + f) / chain.length)),
    });
  }
}

export async function transformRanges(
  isoPath: string,
  key: Buffer,
  ranges: SectorRange[],
  opts: { decrypt: boolean; onProgress?: (fraction: number) => void } = { decrypt: true },
): Promise<void> {
  const SECTORS_PER_CHUNK = 4096; // 8 MiB
  const total = ranges.reduce((n, r) => n + (r.end - r.start + 1), 0);
  let done = 0;
  const fh = await open(isoPath, 'r+');
  try {
    const buf = Buffer.alloc(SECTORS_PER_CHUNK * SECTOR);
    for (const range of ranges) {
      for (let s = range.start; s <= range.end; s += SECTORS_PER_CHUNK) {
        const count = Math.min(SECTORS_PER_CHUNK, range.end - s + 1);
        const bytes = count * SECTOR;
        const { bytesRead } = await fh.read(buf, 0, bytes, s * SECTOR);
        if (bytesRead < bytes) throw new Error(`PS3 ISO is truncated at sector ${s}.`);
        for (let i = 0; i < count; i++) transformSector(buf, i * SECTOR, s + i, key, opts.decrypt);
        await fh.write(buf, 0, bytes, s * SECTOR);
        done += count;
        opts.onProgress?.(done / total);
      }
    }
  } finally {
    await fh.close();
  }
}

// --- ISO9660 walk, used only to verify a decrypt against the IRD's per-file hashes -------

export interface IsoEntry {
  name: string;
  lba: number;
  size: number;
  dir: boolean;
}

function parseDirRecords(buf: Buffer): IsoEntry[] {
  const out: IsoEntry[] = [];
  let p = 0;
  while (p < buf.length) {
    const len = buf[p];
    if (len === 0) {
      p = (Math.floor(p / SECTOR) + 1) * SECTOR; // records never span a sector
      continue;
    }
    const nameLen = buf[p + 32];
    out.push({
      name: buf.toString('latin1', p + 33, p + 33 + nameLen).split(';')[0],
      lba: buf.readUInt32LE(p + 2),
      size: buf.readUInt32LE(p + 10),
      dir: !!(buf[p + 25] & 2),
    });
    p += len;
  }
  return out;
}

async function readDir(fh: FileHandle, lba: number, size: number): Promise<IsoEntry[]> {
  const buf = Buffer.alloc(size);
  await fh.read(buf, 0, size, lba * SECTOR);
  return parseDirRecords(buf);
}

/** Every file on the image (depth-limited), for hash verification. */
export async function listIsoFiles(fh: FileHandle): Promise<IsoEntry[]> {
  const pvd = Buffer.alloc(SECTOR);
  await fh.read(pvd, 0, SECTOR, 0x8000);
  if (pvd.toString('latin1', 1, 6) !== 'CD001') return [];
  const acc: IsoEntry[] = [];
  const walk = async (lba: number, size: number, depth: number): Promise<void> => {
    if (depth > 6) return;
    for (const e of await readDir(fh, lba, size)) {
      if (e.name.trim() === '') continue; // the '.' / '..' records
      if (e.dir) await walk(e.lba, e.size, depth + 1);
      else acc.push(e);
    }
  };
  await walk(pvd.readUInt32LE(158), pvd.readUInt32LE(166), 0);
  return acc;
}

/**
 * Picks a small file that starts inside an encrypted region and has an IRD hash - the only
 * kind of file that can tell these images apart (a plain-region file matches no matter what
 * state the encrypted regions are in).
 */
async function probeFile(
  fh: FileHandle,
  irdFileHashes: Map<number, string>,
  encrypted: SectorRange[],
): Promise<IsoEntry | null> {
  const inEncrypted = (lba: number): boolean => encrypted.some((r) => lba >= r.start && lba <= r.end);
  const files = await listIsoFiles(fh);
  return (
    files.find((f) => f.size > 4096 && f.size <= 8 * 1024 * 1024 && inEncrypted(f.lba) && irdFileHashes.has(f.lba)) ??
    null
  );
}

/**
 * Works out which transform chain this image actually needs, by trying each candidate on ONE
 * small file in memory and checking it against the IRD hash. This exists because the states
 * are otherwise indistinguishable - a pristine encrypted disc and a disc mangled by a
 * wrong-key pass both simply "fail to verify", and guessing wrong corrupts the image
 * further (which is exactly what a naive repair did to a 38 GB disc). Never transform a
 * whole ISO without probing first.
 *
 * Returns the winning chain (empty array = already correct, nothing to do), or null when no
 * candidate reproduces the IRD hash.
 */
export async function probeTransform(
  isoPath: string,
  irdFileHashes: Map<number, string>,
  encrypted: SectorRange[],
  candidates: TransformStep[][],
): Promise<TransformStep[] | null> {
  const fh = await open(isoPath, 'r');
  try {
    const probe = await probeFile(fh, irdFileHashes, encrypted);
    if (!probe) return null;
    const expected = irdFileHashes.get(probe.lba)!;
    const sectors = Math.ceil(probe.size / SECTOR);
    const original = Buffer.alloc(sectors * SECTOR);
    await fh.read(original, 0, original.length, probe.lba * SECTOR);
    for (const chain of candidates) {
      const buf = Buffer.from(original);
      for (const step of chain) {
        for (let i = 0; i < sectors; i++) transformSector(buf, i * SECTOR, probe.lba + i, step.key, step.decrypt);
      }
      if (createHash('md5').update(buf.subarray(0, probe.size)).digest('hex') === expected) return chain;
    }
    return null;
  } finally {
    await fh.close();
  }
}

/**
 * Verifies decrypted content against the IRD's per-file MD5s. Only files that start inside
 * an ENCRYPTED region prove anything (plain-region files match whether or not the decrypt
 * worked), so those are the only ones checked. Returns how many were checked and how many
 * matched; `checked === 0` means the IRD had no usable entry and the caller must not treat
 * that as a pass.
 */
export async function verifyAgainstIrd(
  isoPath: string,
  irdFileHashes: Map<number, string>,
  encrypted: SectorRange[],
  sampleSize = 6,
): Promise<{ checked: number; matched: number; firstBad: string | null }> {
  const inEncrypted = (lba: number): boolean => encrypted.some((r) => lba >= r.start && lba <= r.end);
  const fh = await open(isoPath, 'r');
  try {
    const files = (await listIsoFiles(fh))
      .filter((f) => f.size > 0 && f.size <= 32 * 1024 * 1024 && inEncrypted(f.lba) && irdFileHashes.has(f.lba))
      .slice(0, sampleSize);
    let matched = 0;
    let firstBad: string | null = null;
    for (const f of files) {
      const buf = Buffer.alloc(f.size);
      await fh.read(buf, 0, f.size, f.lba * SECTOR);
      if (createHash('md5').update(buf).digest('hex') === irdFileHashes.get(f.lba)) matched++;
      else firstBad ??= f.name;
    }
    return { checked: files.length, matched, firstBad };
  } finally {
    await fh.close();
  }
}
