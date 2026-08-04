// Automated PS3 Redump-ISO decryption. A downloaded PS3 Redump disc is ENCRYPTED; RPCS3
// needs a decrypted one. We match the ISO to its IRD by exact disc size (FlexBy's JSON
// index - the same source ps3-disc-dumper uses), derive the disc key from it (ps3ird.ts),
// and rewrite the encrypted sector regions in place (ps3iso.ts) - all in pure Node, no
// external binary. A non-Redump ISO (already-decrypted PSN image) matches no IRD and is
// left untouched.
//
// Every success is PROVEN against the IRD's per-file MD5s before it is reported. That is
// not belt-and-braces: this step silently produced garbage for months because it trusted an
// exit code, and since the rewrite happens in place, a wrong key destroyed the download
// while the UI still said "Ready to play". MAIN PROCESS ONLY.
import { open, stat as fsStat } from 'node:fs/promises';
import { basename } from 'node:path';
import { parseIrd, parseIrdFileHashes, discKeyHex } from './ps3ird';
import {
  readPlainRegions,
  encryptedRanges,
  probeTransform,
  transformRangesChain,
  verifyAgainstIrd,
  type TransformStep,
} from './ps3iso';

const IRD_INDEX_URL = 'https://flexby420.github.io/playstation_3_ird_database/all.json';
// The .ird files are served from the raw repo (GitHub Pages only serves the index).
const IRD_BASE = 'https://raw.githubusercontent.com/FlexBy420/playstation_3_ird_database/main/';

interface IrdEntry {
  title: string;
  'disc-size': number;
  link: string;
}

let indexPromise: Promise<Map<number, IrdEntry[]>> | null = null;

/** Fetch + cache the IRD index, bucketed by exact disc size (the match key). */
function loadIndex(): Promise<Map<number, IrdEntry[]>> {
  if (!indexPromise) {
    indexPromise = (async () => {
      const res = await fetch(IRD_INDEX_URL);
      if (!res.ok) throw new Error(`IRD index fetch failed (HTTP ${res.status})`);
      const json = (await res.json()) as Record<string, IrdEntry[]>;
      const bySize = new Map<number, IrdEntry[]>();
      for (const entries of Object.values(json)) {
        for (const e of entries) {
          const arr = bySize.get(e['disc-size']);
          if (arr) arr.push(e);
          else bySize.set(e['disc-size'], [e]);
        }
      }
      return bySize;
    })().catch((e: unknown) => {
      indexPromise = null; // allow retry
      throw e;
    });
  }
  return indexPromise;
}

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Find the IRD for an ISO by exact disc size; disambiguate a size collision by name overlap. */
async function findIrd(sizeBytes: number, filename: string): Promise<IrdEntry | null> {
  const matches = (await loadIndex()).get(sizeBytes);
  if (!matches || matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  const nameWords = new Set(normalize(filename).split(' ').filter(Boolean));
  let best = matches[0];
  let bestScore = -1;
  for (const m of matches) {
    const overlap = normalize(basename(m.link))
      .split(' ')
      .filter((w) => nameWords.has(w)).length;
    // Strongly prefer repo-hosted (relative) links over external ones (ps3ird.free.fr) -
    // the repo copy is always fetchable; name overlap decides among same-host candidates.
    const score = (m.link.startsWith('http') ? 0 : 1000) + overlap;
    if (score > bestScore) {
      best = m;
      bestScore = score;
    }
  }
  return best;
}

export type DecryptPhase = 'matching' | 'ird' | 'decrypting' | 'verifying';

/** Downloads an IRD; the link is either repo-relative ("Redump/…ird") or an absolute URL. */
async function fetchIrd(entry: IrdEntry): Promise<Buffer> {
  const url = entry.link.startsWith('http')
    ? entry.link
    : IRD_BASE + entry.link.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`IRD download failed (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Decrypt a PS3 Redump ISO IN PLACE if it's a known encrypted disc. Returns the (unchanged)
 * path + size on success, or null when there is genuinely nothing to do (no IRD match, or
 * an image with no encrypted regions - e.g. an already-decrypted PSN rip).
 *
 * THROWS when the disc is encrypted but the result can't be PROVEN correct against the
 * IRD's per-file hashes. That post-condition is the whole point: this silently produced
 * garbage for months, and because the rewrite is in place, a wrong key permanently mangled
 * the file while the download still reported "Ready to play" (see repairPs3Iso).
 */
export async function maybeDecryptPs3(
  isoPath: string,
  sizeBytes: number,
  onPhase?: (phase: DecryptPhase) => void,
  onProgress?: (fraction: number) => void,
): Promise<{ path: string; size: number } | null> {
  onPhase?.('matching');
  const entry = await findIrd(sizeBytes, basename(isoPath)).catch(() => null);
  if (!entry) return null; // not a known encrypted Redump PS3 disc

  onPhase?.('ird');
  const ird = await fetchIrd(entry);
  const keys = parseIrd(ird);
  const real: TransformStep = { key: Buffer.from(discKeyHex(keys), 'hex'), decrypt: true };
  const undoBadPass: TransformStep = { key: keys.data1, decrypt: false };

  const fh = await open(isoPath, 'r');
  const plain = await readPlainRegions(fh).finally(() => void fh.close());
  if (!plain) return null; // no region table - not a Redump-style PS3 image
  const encrypted = encryptedRanges(plain);
  if (encrypted.length === 0) return null; // wholly plain: nothing to decrypt

  const hashes = parseIrdFileHashes(ird);
  // Probe ONE small file before rewriting tens of GB. These states are indistinguishable
  // from the outside - a pristine encrypted disc and a disc mangled by a wrong-key pass
  // both just "fail to verify" - so guessing between them corrupts the image FURTHER.
  // Exactly one chain can reproduce the IRD hash, which is what makes this safe.
  const chain = await probeTransform(isoPath, hashes, encrypted, [
    [], // already decrypted (a re-run, or an image that needed nothing)
    [real], // pristine encrypted disc - the normal path
    [undoBadPass, real], // mangled by the pre-2026-07-22 wrong-key (data1) pass
  ]);
  if (chain === null) {
    throw new Error('PS3 disc is in an unrecognized state: no known transform reproduces the IRD file hashes.');
  }
  if (chain.length === 0) return null; // already correct - nothing to do

  onPhase?.('decrypting');
  await transformRangesChain(isoPath, chain, encrypted, onProgress);

  onPhase?.('verifying');
  const { checked, matched, firstBad } = await verifyAgainstIrd(isoPath, hashes, encrypted);
  if (checked === 0) throw new Error('PS3 decrypt is unverifiable: the IRD lists no file in an encrypted region.');
  if (matched !== checked) {
    throw new Error(`PS3 decrypt failed verification (${matched}/${checked} files match the IRD; first bad: ${firstBad}).`);
  }
  return { path: isoPath, size: (await fsStat(isoPath)).size };
}
