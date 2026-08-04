import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import type { HashAlgo } from '@shared/contracts/storage';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export interface FileHashes {
  crc32: string;
  md5: string;
  sha1: string;
}

/** Streams a file once, returning all three hashes (lowercase hex). */
export async function hashFile(path: string): Promise<FileHashes> {
  const md5 = createHash('md5');
  const sha1 = createHash('sha1');
  let crc = 0xffffffff;
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk: Buffer | string) => {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      md5.update(buf);
      sha1.update(buf);
      for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    });
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  crc = (crc ^ 0xffffffff) >>> 0;
  return {
    crc32: crc.toString(16).padStart(8, '0'),
    md5: md5.digest('hex'),
    sha1: sha1.digest('hex'),
  };
}

export async function verifyFile(path: string, expected: { algo: HashAlgo; value: string }): Promise<boolean> {
  const hashes = await hashFile(path);
  return hashes[expected.algo].toLowerCase() === expected.value.toLowerCase();
}
