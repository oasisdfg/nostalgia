// BitTorrent downloads via the bundled aria2 daemon - no external client needed. aria2
// (Enabled Features: BitTorrent) speaks the full protocol (DHT, trackers, PEX, web seeds).
// The key trick for the big per-collection Redump torrents (e.g. Minerva Archive) is
// --select-file: pull ONE game out of a thousand-file torrent without fetching the rest.
//
// Two entry points: parseTorrent() (map a filename -> 1-based select index from raw
// .torrent bytes) and downloadTorrentViaAria2() (add + poll + return the on-disk paths).
// A magnet is first resolved to .torrent bytes via fetchTorrentMetadata(). MAIN ONLY.
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { ensureAria2 } from './daemon';
import type { Aria2Client } from './rpcClient';

const POLL_MS = 500;
const STATUS_KEYS = [
  'gid',
  'status',
  'totalLength',
  'completedLength',
  'downloadSpeed',
  'connections',
  'errorCode',
  'errorMessage',
];
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface TorrentFile {
  /** 1-based index, matches aria2 --select-file. */
  index: number;
  /** File path within the torrent (POSIX-style, relative to the torrent name). */
  path: string;
  length: number;
}
export interface TorrentInfo {
  name: string;
  files: TorrentFile[];
  totalLength: number;
}

export interface TorrentProgress {
  bytesReceived: number;
  bytesTotal: number | null;
  fraction: number | null;
  bytesPerSecond: number;
  connections: number;
}
export interface TorrentDownloadOptions {
  /** Parent directory; aria2 creates <dir>/<torrent name>/… beneath it. */
  dir: string;
  /** 1-based file index(es) to fetch; omit to download the whole torrent. */
  selectIndices?: number[];
  signal?: AbortSignal;
  onProgress?: (p: TorrentProgress) => void;
}
export interface TorrentDownloadResult {
  outcome: 'completed' | 'aborted';
  bytesWritten: number;
  /** Absolute on-disk paths of the selected (downloaded) files, as aria2 reports them. */
  files: string[];
}

// ---- bencode (just enough to read the info/files dict) ---------------------------------

type Bencode = number | Buffer | Bencode[] | { [k: string]: Bencode };

function decode(buf: Buffer, start: number): [Bencode, number] {
  const c = buf[start];
  if (c === 0x69) {
    // i<int>e
    const end = buf.indexOf(0x65, start);
    return [Number(buf.toString('ascii', start + 1, end)), end + 1];
  }
  if (c === 0x6c) {
    // l…e
    const out: Bencode[] = [];
    let i = start + 1;
    while (buf[i] !== 0x65) {
      const [v, next] = decode(buf, i);
      out.push(v);
      i = next;
    }
    return [out, i + 1];
  }
  if (c === 0x64) {
    // d…e
    const out: { [k: string]: Bencode } = {};
    let i = start + 1;
    while (buf[i] !== 0x65) {
      const [k, afterKey] = decode(buf, i);
      const [v, next] = decode(buf, afterKey);
      out[(k as Buffer).toString('utf8')] = v;
      i = next;
    }
    return [out, i + 1];
  }
  // <len>:<bytes>
  const colon = buf.indexOf(0x3a, start);
  const len = Number(buf.toString('ascii', start, colon));
  const from = colon + 1;
  return [buf.subarray(from, from + len), from + len];
}

/** Parse raw .torrent bytes into a name + flat file list with 1-based select indices. */
export function parseTorrent(buf: Buffer): TorrentInfo {
  const [root] = decode(buf, 0);
  const info = (root as { info?: { [k: string]: Bencode } }).info;
  if (!info) throw new Error('invalid torrent: no info dict');
  const name = (info.name as Buffer).toString('utf8');
  const rawFiles = info.files as Array<{ length: number; path: Buffer[] }> | undefined;
  const files: TorrentFile[] = [];
  if (Array.isArray(rawFiles)) {
    rawFiles.forEach((f, i) => {
      files.push({
        index: i + 1,
        path: f.path.map((p) => p.toString('utf8')).join('/'),
        length: Number(f.length),
      });
    });
  } else {
    // single-file torrent
    files.push({ index: 1, path: name, length: Number(info.length as number) });
  }
  const totalLength = files.reduce((sum, f) => sum + f.length, 0);
  return { name, files, totalLength };
}

/** urn:btih:<hash> from a magnet, lowercased (aria2 saves metadata as <hash>.torrent). */
function infoHashFromMagnet(magnet: string): string | null {
  const m = /urn:btih:([0-9a-fA-F]{40}|[0-9a-zA-Z]{32})/.exec(magnet);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Resolve a magnet to its .torrent bytes by fetching ONLY the metadata (fast, ~KB), so
 * the caller can parse the file list / pick a --select-file index before committing to
 * the real transfer. Returns null if aria2 is unavailable or metadata never arrives.
 */
export async function fetchTorrentMetadata(
  magnet: string,
  dir: string,
  signal?: AbortSignal,
): Promise<Buffer | null> {
  const client = await ensureAria2();
  if (!client) return null;
  const hash = infoHashFromMagnet(magnet);
  if (!hash) throw new Error('magnet has no btih info hash');

  const gid = await client.addUri([magnet], {
    dir,
    'bt-metadata-only': 'true',
    'bt-save-metadata': 'true',
    'follow-torrent': 'false',
  });
  try {
    for (;;) {
      if (signal?.aborted) {
        await stop(client, gid);
        return null;
      }
      const st = await client.tellStatus(gid, ['status', 'errorMessage']);
      if (st.status === 'complete') break;
      if (st.status === 'error') throw new Error(st.errorMessage || 'metadata fetch failed');
      if (st.status === 'removed') return null;
      await sleep(POLL_MS);
    }
  } finally {
    await client.removeDownloadResult(gid).catch(() => undefined);
  }
  return readFile(join(dir, `${hash}.torrent`));
}

/**
 * Download selected files from a torrent (given its raw bytes) via aria2, polling to
 * progress. Only --select-file'd files are fetched; the rest are skipped and any
 * placeholder removed. Returns the absolute paths aria2 wrote (from getFiles), so the
 * caller never has to reconstruct <dir>/<name>/<path>. null if aria2 is unavailable.
 */
export async function downloadTorrentViaAria2(
  torrent: Buffer,
  opts: TorrentDownloadOptions,
): Promise<TorrentDownloadResult | null> {
  const client = await ensureAria2();
  if (!client) return null;

  const info = parseTorrent(torrent);
  const selected = opts.selectIndices?.length
    ? info.files.filter((f) => opts.selectIndices!.includes(f.index))
    : info.files;
  // Progress is measured against the SELECTED bytes, not the whole torrent - aria2's
  // totalLength counts every file, which would make a single-game pull read as ~0%.
  const selectedTotal = selected.reduce((sum, f) => sum + f.length, 0) || null;

  const options: Record<string, string> = {
    dir: opts.dir,
    'seed-time': '0',
    'bt-remove-unselected-file': 'true',
    // Never preallocate the whole (possibly multi-TB) torrent - only selected files.
    'file-allocation': 'none',
    // Give up on a stalled torrent instead of hanging the queue forever.
    'bt-stop-timeout': '300',
  };
  if (opts.selectIndices?.length) options['select-file'] = opts.selectIndices.join(',');

  const gid = await client.addTorrent(torrent.toString('base64'), options);

  let completed = 0;
  let pollFailures = 0;
  try {
    for (;;) {
      if (opts.signal?.aborted) {
        await stop(client, gid);
        return { outcome: 'aborted', bytesWritten: completed, files: [] };
      }
      let st;
      try {
        st = await client.tellStatus(gid, STATUS_KEYS);
        pollFailures = 0;
      } catch (pollErr) {
        // Tolerate transient RPC hiccups; the transfer keeps running headless otherwise.
        if (++pollFailures >= 5) throw pollErr;
        await sleep(POLL_MS);
        continue;
      }
      completed = Number(st.completedLength) || completed;
      opts.onProgress?.({
        bytesReceived: completed,
        bytesTotal: selectedTotal,
        fraction: selectedTotal ? Math.min(completed / selectedTotal, 1) : null,
        bytesPerSecond: Number(st.downloadSpeed) || 0,
        connections: Number(st.connections) || 0,
      });
      if (st.status === 'complete') {
        const files = await client.getFiles(gid).catch(() => []);
        await client.removeDownloadResult(gid).catch(() => undefined);
        return {
          outcome: 'completed',
          bytesWritten: completed,
          files: files.filter((f) => f.selected === 'true').map((f) => f.path),
        };
      }
      if (st.status === 'error') {
        await client.removeDownloadResult(gid).catch(() => undefined);
        throw new Error(st.errorMessage || `aria2 torrent failed (code ${st.errorCode ?? '?'})`);
      }
      if (st.status === 'removed') return { outcome: 'aborted', bytesWritten: completed, files: [] };
      await sleep(POLL_MS);
    }
  } catch (e) {
    if (opts.signal?.aborted) {
      await stop(client, gid);
      return { outcome: 'aborted', bytesWritten: completed, files: [] };
    }
    await stop(client, gid);
    throw e;
  }
}

/** Stop + forget the gid; the on-disk .aria2 control file persists for resume. */
async function stop(client: Aria2Client, gid: string): Promise<void> {
  await client.remove(gid).catch(() => client.forceRemove(gid).catch(() => undefined));
  await client.removeDownloadResult(gid).catch(() => undefined);
}
