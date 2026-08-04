// PS3 IRD parsing: the disc key and the per-file hash table used to VERIFY a decrypt.
//
// An .ird file is a gzip stream. Its decompressed tail holds (from the end): an 8-byte
// trailer, then Data2 (16), then Data1 (16), preceded by the 115-byte disc PIC. Data1 is
// the disc key in its stored (encrypted) form - see discKeyHex for the derivation that
// turns it into the key the sector cipher actually uses. MAIN PROCESS ONLY.
import { gunzipSync } from 'node:zlib';
import { createCipheriv } from 'node:crypto';

/**
 * Per-file MD5s from the IRD, keyed by the file's START SECTOR - the only way to prove a
 * decrypt actually worked (see ps3iso.verifyAgainstIrd). Layout after the fixed header:
 * gzipped header/footer blobs, the per-region hashes, then `fileCount` × (u64 sector, md5).
 */
export function parseIrdFileHashes(irdGzip: Buffer): Map<number, string> {
  const ird = gunzipSync(irdGzip);
  let o = 4 + 1 + 9; // "3IRD" + version + 9-byte game id
  const titleLen = ird[o];
  o += 1 + titleLen + 4 + 5 + 5; // title + update/game/app version strings
  const headerLen = ird.readUInt32LE(o);
  o += 4 + headerLen;
  const footerLen = ird.readUInt32LE(o);
  o += 4 + footerLen;
  const regionCount = ird[o];
  o += 1 + regionCount * 16;
  const fileCount = ird.readUInt32LE(o);
  o += 4;
  const out = new Map<number, string>();
  for (let i = 0; i < fileCount; i++) {
    const sector = Number(ird.readBigUInt64LE(o));
    o += 8;
    out.set(sector, ird.toString('hex', o, o + 16));
    o += 16;
  }
  return out;
}

export interface IrdKeys {
  /** 16-byte AES disc key (a.k.a. Data1 / the .dkey). */
  data1: Buffer;
  /** 16-byte Data2. */
  data2: Buffer;
  /** 115-byte disc PIC. */
  pic: Buffer;
}

/**
 * Parse a raw .ird (gzip) file and derive the disc keys + the 3K3Y region, byte-for-byte
 * as the PS3 ISO Patcher does. Slice math mirrors test_patcher Form1.cs exactly:
 *   Data1 = ird[len-40 .. len-24]   (region bytes 16..32)
 *   Data2 = ird[len-24 .. len-8]    (region bytes 32..48)
 *   PIC   = ird[len-155 .. len-40]  (region bytes 48..163)
 */
export function parseIrd(irdGzip: Buffer): IrdKeys {
  const ird = gunzipSync(irdGzip);
  const n = ird.length;
  if (n < 155) throw new Error('IRD file is too small / not a valid IRD.');
  const data1 = Buffer.from(ird.subarray(n - 40, n - 24));
  const data2 = Buffer.from(ird.subarray(n - 24, n - 8));
  const pic = Buffer.from(ird.subarray(n - 155, n - 40));
  return { data1, data2, pic };
}

// Data1 is the disc key as it sits on the disc: ENCRYPTED. PS3Dec's `--dk` (and redump's
// published .dkey files) want the PLAINTEXT key, which is AES-128-CBC *encrypt* of Data1
// under these two well-known 3K3Y constants. Passing Data1 straight through - as this did
// until 2026-07-21 - makes ps3decrs exit 0 while writing garbage, so a downloaded disc
// looked "Ready to play" and then failed in RPCS3 with "invalid or corrupted".
//
// Verified against the official redump .dkey for three discs (Minerva's
// "Redump - Sony - PlayStation 3 - Disc Keys TXT" collection), IRD Data1 -> .dkey:
//   BLUS-30065 Simpsons Game, The  a96891d4… -> B48FF04D0EBDC147B8432A995764C626  ✓
//   BLUS-30464 Skate 3             …         -> A7675BEB4FE7562D664676F2350A3086  ✓
//   BCUS-98111 God of War III      …         -> E81ED3E63F76A6587B75C590BBD69729  ✓
const DISC_KEY_AES = Buffer.from('380bcf0b53455b3c7817ab4fa3ba90ed', 'hex');
const DISC_KEY_IV = Buffer.from('69474772af6fdab342743aefaa186287', 'hex');

/** The plaintext AES disc key as a 32-char hex string - the value for PS3Dec `--dk`. */
export function discKeyHex(keys: IrdKeys): string {
  const cipher = createCipheriv('aes-128-cbc', DISC_KEY_AES, DISC_KEY_IV);
  cipher.setAutoPadding(false); // exactly one 16-byte block in, one out
  return Buffer.concat([cipher.update(keys.data1), cipher.final()]).toString('hex');
}
