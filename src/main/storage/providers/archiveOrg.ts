// Internet Archive StorageProvider. The first real remote provider. Reads an
// item's file list from the metadata API, fuzzy-matches catalog titles to
// playable files, and serves resumable downloads. Large files are fetched over
// MULTIPLE PARALLEL RANGED CONNECTIONS - archive.org throttles per-connection
// (~0.14 MB/s), so N segments give ~N× throughput. MAIN PROCESS ONLY.
import { app } from 'electron';
import { createWriteStream } from 'node:fs';
import { open as fsOpen, readFile, writeFile, rm, stat as fsStat } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import type {
  StorageProvider,
  ProviderCapabilities,
  RemoteEntry,
  RemoteStat,
  DownloadOptions,
  DownloadResult,
  HashRef,
} from '@shared/contracts/storage';
import { verifyFile } from '../hashing';
import { downloadViaAria2 } from '../aria2/download';
import { archiveAuthHeader, hasArchiveCredential } from '../archiveCreds';
import { normalizeTitle, pickPreferred } from '../../catalog/archiveMatch';

interface ArchiveFileMeta {
  name: string;
  size: number;
  md5: string | null;
}
export interface ArchiveMatch {
  filename: string;
  sizeBytes: number;
  md5: string | null;
}

// Demos/prototypes/betas tagged in parens are NOT the retail game - they share the
// game's normalized title and would collide with it (→ ambiguous → dropped, so the
// real game loses its match). Exclude them from the index entirely.
const AUX_RELEASE_RE = /\([^)]*\b(?:demo|proto(?:type)?|beta|sample|kiosk|trial|preview|promo)\b[^)]*\)/i;

const PARALLEL_CONNECTIONS = 8;
export const SEGMENT_SIZE = 4 * 1024 * 1024; // 4 MB per ranged segment
const PARALLEL_MIN = 24 * 1024 * 1024; // below this, a single stream is simpler/cheaper

const isAbortError = (e: unknown): boolean =>
  (e instanceof Error && e.name === 'AbortError') || (e as NodeJS.ErrnoException)?.code === 'ABORT_ERR';

export class ArchiveOrgStorageProvider implements StorageProvider {
  private filesPromise: Promise<ArchiveFileMeta[]> | null = null;
  private index: Map<string, ArchiveFileMeta> = new Map();
  /** Mirror hosts + path from the item metadata (d1/d2/dir) - extra download sources. */
  private mirrors: { hosts: string[]; dir: string } = { hosts: [], dir: '' };

  /**
   * @param item       Archive item identifier (e.g. "playstation2_essentials").
   * @param opts       Per-console profile: the playable file extensions (file filter +
   *                   extension stripping), optional console-specific strip patterns,
   *                   optionally a CONTAINER ZIP inside the item (`zipPath`) whose
   *                   members are the per-game files (No-Intro set zips like ni-roms),
   *                   and optionally a `pathPrefix` restricting indexing to one subfolder
   *                   of a multi-console item (TOSEC "Dreamcast/Games/…" inside a Sega set).
   */
  constructor(
    private readonly item: string,
    private readonly opts: { extensions: string[]; strip?: string[]; zipPath?: string; pathPrefix?: string },
  ) {}

  getCapabilities(): ProviderCapabilities {
    return {
      providerId: 'archive-org',
      // Zip members are served by the archive's on-the-fly unzip service, which
      // ignores Range requests - no resume, restart from 0 (files are small ROMs).
      supportsRanged: !this.opts.zipPath,
      supportsHashManifest: true,
      supportsDirectUrl: true,
    };
  }

  /** `zipPath` with each segment URL-encoded (slashes kept literal). */
  private encodedZipPath(): string {
    return (this.opts.zipPath ?? '').split('/').map(encodeURIComponent).join('/');
  }

  /**
   * Lists the members of the container zip via the data node's zip-view service
   * (`view_archive.php`). The canonical /download listing 302s to the data node and
   * fetch drops the Authorization header across that redirect, so restricted items
   * (ni-roms) must be listed on the data node directly.
   */
  private async listZipMembers(): Promise<{ name: string; size?: string; md5?: string | null }[]> {
    const host = this.mirrors.hosts[0];
    const url = host
      ? `https://${host}/view_archive.php?archive=${this.mirrors.dir}/${this.encodedZipPath()}`
      : `https://archive.org/download/${encodeURIComponent(this.item)}/${this.encodedZipPath()}/`;
    // Timeout: a hung listing request would otherwise stall availability checks
    // indefinitely (the UI sits on "Checking availability…" with no way out).
    const res = await fetch(url, { headers: this.authHeaders(), signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Archive zip listing failed (HTTP ${res.status}).`);
    const html = await res.text();
    // Rows look like: <tr><td><a href="…/<set>.zip/<member-enc>">Name</a><td><td>date<td id="size">123</tr>
    const out: { name: string; size?: string; md5?: string | null }[] = [];
    for (const row of html.split('<tr>')) {
      const href = /<a href="[^"]*?\/([^"/]+)">/.exec(row);
      const size = /<td id="size">(\d+)/.exec(row);
      if (!href || !size) continue;
      try {
        out.push({ name: decodeURIComponent(href[1]), size: size[1], md5: null });
      } catch {
        /* malformed escape in a stray row - skip it */
      }
    }
    return out;
  }

  private async loadFiles(): Promise<ArchiveFileMeta[]> {
    if (!this.filesPromise) {
      this.filesPromise = (async () => {
        // Timeout so one hung metadata request can't wedge every availability check
        // that routes through this item; loadFiles resets filesPromise on failure,
        // so the next check retries cleanly.
        const res = await fetch(`https://archive.org/metadata/${encodeURIComponent(this.item)}`, {
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) throw new Error(`Archive metadata request failed (HTTP ${res.status}).`);
        const json = (await res.json()) as {
          files?: { name: string; size?: string; md5?: string }[];
          metadata?: { 'access-restricted-item'?: string | boolean };
          is_dark?: boolean;
          d1?: string;
          d2?: string;
          dir?: string;
        };
        // Capture the item's mirror hosts: aria2 caps at 16 connections PER SERVER, so
        // feeding it both d1 and d2 doubles the ceiling to 32 across the two hosts.
        if (json.dir) {
          this.mirrors = { hosts: [...new Set([json.d1, json.d2].filter((h): h is string => !!h))], dir: json.dir };
        }
        // A truly DARK item serves no file list at all (metadata omits `files`) - it is
        // gone regardless of credentials, so always skip.
        if (json.is_dark) {
          if (!app.isPackaged) console.warn(`[archive] item "${this.item}" is dark - skipping (no files).`);
          this.index = new Map();
          return [];
        }
        // An `access-restricted-item` still serves its metadata + file list, but the
        // actual bytes need an authenticated request (HTTP 401 otherwise). With S3 creds
        // configured we CAN download it (over the direct data node - see mirrorUrls), so
        // index it normally. Without creds, treat it as empty so the catalog never offers
        // a download guaranteed to 401 - the title just shows as unavailable instead.
        const restricted =
          json.metadata?.['access-restricted-item'] === 'true' || json.metadata?.['access-restricted-item'] === true;
        if (restricted && !hasArchiveCredential()) {
          if (!app.isPackaged)
            console.warn(`[archive] item "${this.item}" is access-restricted and no ARCHIVE_S3 creds set - skipping.`);
          this.index = new Map();
          return [];
        }
        // Container-zip mode: the per-game files are MEMBERS of one set zip inside
        // the item, listed via the zip-view service (no md5s; hashed post-download).
        const rawFiles = this.opts.zipPath ? await this.listZipMembers() : (json.files ?? []);
        // A configured (non-dark, non-restricted-skipped) item should always list files. An
        // EMPTY result here means a throttled/partial/truncated response - throwing nulls
        // filesPromise so the NEXT availability check retries, instead of caching an empty
        // index that leaves the title stuck "unavailable" forever (the Skate 3 bug).
        if (rawFiles.length === 0) {
          throw new Error(`archive item "${this.item}" returned no files - likely throttled; not caching.`);
        }
        // Restrict to one subfolder when this item packs several consoles (a TOSEC
        // multi-console set): index only files under pathPrefix so a Dreamcast source
        // doesn't pull in the item's Saturn/Genesis/… files too. Exact byte prefix.
        const scoped = this.opts.pathPrefix
          ? rawFiles.filter((f) => f.name.startsWith(this.opts.pathPrefix!))
          : rawFiles;
        // Only playable files for this console (per-config extensions), and never
        // demo/prototype/beta builds (they collide with the retail game's title).
        const extRe = new RegExp(`\\.(${this.opts.extensions.join('|')})$`, 'i');
        const files = scoped
          .filter((f) => extRe.test(f.name) && !AUX_RELEASE_RE.test(f.name))
          .map((f) => ({ name: f.name, size: Number(f.size ?? 0), md5: f.md5 ?? null }));
        // Build the match index. A normalized title can map to several files -
        // usually the SAME game in different regions/revisions (USA/PAL, v1.00/
        // v2.00). pickPreferred resolves those to one (USA-first, latest revision);
        // only a genuine tie (e.g. two discs of a multi-disc game, true duplicates)
        // stays AMBIGUOUS and is dropped, so matchTitle returns null (greyed) rather
        // than silently picking the wrong disc/variant. Keys are exact.
        const groups = new Map<string, ArchiveFileMeta[]>();
        for (const f of files) {
          const key = normalizeTitle(f.name, this.opts);
          const g = groups.get(key);
          if (g) g.push(f);
          else groups.set(key, [f]);
        }
        const index = new Map<string, ArchiveFileMeta>();
        let dropped = 0;
        for (const [key, group] of groups) {
          const best = pickPreferred(group, key);
          if (best) index.set(key, best);
          else dropped++;
        }
        this.index = index;
        if (dropped > 0 && !app.isPackaged) {
          console.warn(`[archive] ${dropped} ambiguous title(s) dropped from match index`);
        }
        return files;
      })().catch((e: unknown) => {
        this.filesPromise = null; // allow retry on next call
        throw e;
      });
    }
    return this.filesPromise;
  }

  async list(): Promise<RemoteEntry[]> {
    const files = await this.loadFiles();
    return files.map((f) => ({ key: f.name, isDirectory: false, sizeBytes: f.size }));
  }

  async stat(key: string): Promise<RemoteStat> {
    const files = await this.loadFiles();
    const f = files.find((x) => x.name === key);
    return { key, sizeBytes: f?.size ?? null, hashes: f?.md5 ? [{ algo: 'md5', value: f.md5 }] : [] };
  }

  async getDownloadUrl(key: string): Promise<string> {
    if (this.opts.zipPath) {
      return `https://archive.org/download/${encodeURIComponent(this.item)}/${this.encodedZipPath()}/${encodeURIComponent(key)}`;
    }
    return `https://archive.org/download/${encodeURIComponent(this.item)}/${encodeURIComponent(key)}`;
  }

  /**
   * All download URLs for a file: the direct mirror hosts (d1/d2, verified to serve
   * ranged 206s). Multiple distinct hosts let aria2 exceed its 16-connections-per-server
   * cap. The canonical archive.org/download URL is appended ONLY when no direct mirror is
   * known - it 302-redirects to a data node, and both fetch and aria2 drop the
   * Authorization header across that redirect, so it would 401 for restricted items.
   */
  private async mirrorUrls(key: string): Promise<string[]> {
    await this.loadFiles(); // populates this.mirrors
    // Zip members are served by the data node's zip-view service, not as plain paths.
    // The auth header survives on these direct-node URLs (needed for restricted items).
    if (this.opts.zipPath) {
      const urls = this.mirrors.hosts.map(
        (h) => `https://${h}/view_archive.php?archive=${this.mirrors.dir}/${this.encodedZipPath()}&file=${encodeURIComponent(key)}`,
      );
      if (urls.length === 0) urls.push(await this.getDownloadUrl(key));
      return urls;
    }
    const encodedKey = key.split('/').map(encodeURIComponent).join('/');
    const urls = this.mirrors.hosts.map((h) => `https://${h}${this.mirrors.dir}/${encodedKey}`);
    if (urls.length === 0) urls.push(await this.getDownloadUrl(key));
    return urls;
  }

  /** A single direct download URL for the fallback engine (auth header survives here). */
  private async directUrl(key: string): Promise<string> {
    return (await this.mirrorUrls(key))[0];
  }

  /** Auth header for direct-node fetches (restricted items); empty for public items. */
  private authHeaders(): Record<string, string> {
    const auth = archiveAuthHeader();
    return auth ? { Authorization: auth } : {};
  }

  /** High-confidence exact-normalized match of an IGDB title to a file. */
  async matchTitle(title: string): Promise<ArchiveMatch | null> {
    await this.loadFiles();
    const f = this.index.get(normalizeTitle(title, this.opts));
    return f ? { filename: f.name, sizeBytes: f.size, md5: f.md5 } : null;
  }

  async hasGame(ref: { igdbId: number; name: string; platformId: number }): Promise<boolean> {
    return (await this.matchTitle(ref.name)) != null;
  }

  async download(key: string, opts: DownloadOptions): Promise<DownloadResult> {
    // Zip members: the zip-view service ignores Range and streams chunked (no
    // Content-Length), so aria2/parallel segments would corrupt or stall - one
    // plain stream. downloadSingle restarts cleanly when the server ignores Range.
    if (this.opts.zipPath) return this.downloadSingle(key, opts);

    // Prefer aria2 (mature multi-connection engine - much faster than the built-in
    // downloader against archive.org's per-connection throttle), fed every mirror of
    // the file so it can spread connections across hosts. Under smoke, force in-order
    // pieces so the .part fills contiguously and the test can byte-verify a [0,n)
    // prefix; no effect on production downloads.
    const aria2Opts: Record<string, string> = {};
    if (process.env.NOSTALGIA_SMOKE === '1') aria2Opts['stream-piece-selector'] = 'inorder';
    // Restricted items need the S3 auth header on every request; aria2 re-sends a
    // --header across mirrors/retries. Public items simply ignore it.
    const auth = archiveAuthHeader();
    if (auth) aria2Opts.header = `Authorization: ${auth}`;
    const viaAria2 = await downloadViaAria2(await this.mirrorUrls(key), opts, aria2Opts);
    if (viaAria2) return viaAria2;

    // Fallback when aria2 is unavailable: parallel ranged segments for big files
    // (archive.org throttles per-connection), a single stream for small ones.
    const total = (await this.stat(key)).sizeBytes ?? 0;
    return total >= PARALLEL_MIN ? this.downloadParallel(key, total, opts) : this.downloadSingle(key, opts);
  }

  /**
   * Multi-connection download: split the file into fixed segments, fetch up to
   * PARALLEL_CONNECTIONS at once (lowest-index pending first), and write each to its
   * own offset (positioned writes into one `.part`). archive.org throttles per
   * connection, so N segments ≈ N× throughput.
   *
   * A sidecar `<dest>.parts` records bytes-on-disk PER SEGMENT (`{ total, segments }`),
   * so a paused/interrupted download resumes each segment from where it stopped (no
   * re-download of partial segments, no progress dip). The returned `bytesWritten` is
   * the total bytes on disk (sum across segments) - disk-accurate and ≤ the .part size,
   * which is all the manager needs (the provider self-resumes from the sidecar and
   * ignores the manager's single rangeStart for this path).
   */
  private async downloadParallel(key: string, total: number, opts: DownloadOptions): Promise<DownloadResult> {
    const url = await this.directUrl(key);
    const authHeaders = this.authHeaders();
    const { destPath, signal, onProgress } = opts;
    const sidecar = `${destPath}.parts`;
    const segCount = Math.ceil(total / SEGMENT_SIZE);
    const segBytes = (i: number): number => Math.min(SEGMENT_SIZE, total - i * SEGMENT_SIZE);

    // Resume: bytes already on disk per segment.
    const progress = new Map<number, number>();
    try {
      const meta = JSON.parse(await readFile(sidecar, 'utf8')) as { total?: number; segments?: Record<string, number> };
      if (meta.total === total && meta.segments) {
        for (const [k, v] of Object.entries(meta.segments)) progress.set(Number(k), Math.min(v, segBytes(Number(k))));
      }
    } catch {
      /* no/stale sidecar → fresh */
    }
    // Self-heal: a segment can't claim bytes the .part doesn't physically hold (e.g.
    // the .part was deleted but the sidecar lingered → partSize 0 → drop every entry).
    const partSize = await fsStat(destPath).then((s) => s.size).catch(() => 0);
    for (const [i, v] of progress) if (i * SEGMENT_SIZE + v > partSize) progress.delete(i);

    const fh = await fsOpen(destPath, 'r+').catch(async () => {
      await writeFile(destPath, '');
      return fsOpen(destPath, 'r+');
    });

    const onDisk = (): number => {
      let n = 0;
      for (const v of progress.values()) n += v;
      return n;
    };
    let received = onDisk();
    let etag: string | null = null;
    let lastModified: string | null = null;

    // Persist the per-segment map. All writes are serialized through one promise chain
    // so they never overlap (no torn sidecar) and the FINAL `await persist()` is
    // guaranteed to finish a complete write before we report 'paused'. The snapshot is
    // taken synchronously inside the chained step, so it captures the latest progress.
    let persistChain: Promise<void> = Promise.resolve();
    let lastPersist = Date.now();
    const persist = (): Promise<void> => {
      persistChain = persistChain.then(() =>
        writeFile(sidecar, JSON.stringify({ total, segments: Object.fromEntries(progress) })).catch(() => undefined),
      );
      return persistChain;
    };

    const pending: number[] = [];
    for (let i = 0; i < segCount; i++) if ((progress.get(i) ?? 0) < segBytes(i)) pending.push(i);

    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < pending.length) {
        if (signal?.aborted) return;
        const seg = pending[next++];
        const segStart = seg * SEGMENT_SIZE;
        let pos = progress.get(seg) ?? 0; // resume this segment from where it stopped
        const from = segStart + pos;
        const to = segStart + segBytes(seg) - 1;
        if (from > to) continue; // already complete
        const res = await fetch(url, { headers: { ...authHeaders, Range: `bytes=${from}-${to}` }, signal });
        if (!res.ok && res.status !== 206) throw new Error(`Archive segment ${seg} failed (HTTP ${res.status}).`);
        if (!res.body) throw new Error('Archive segment returned an empty body.');
        etag ??= res.headers.get('etag');
        lastModified ??= res.headers.get('last-modified');
        const reader = (res.body as unknown as WebReadableStream<Uint8Array>).getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          await fh.write(value, 0, value.byteLength, segStart + pos);
          pos += value.byteLength;
          progress.set(seg, pos);
          received += value.byteLength;
          onProgress?.({ bytesReceived: received, bytesTotal: total, fraction: received / total, bytesPerSecond: 0 });
          if (Date.now() - lastPersist > 1000) {
            lastPersist = Date.now();
            void persist();
          }
        }
      }
    };

    // allSettled (not all): wait for EVERY worker to finish before closing the handle,
    // so no positioned write is ever in flight while we close (no torn write / EBADF).
    const results = await Promise.allSettled(
      Array.from({ length: Math.min(PARALLEL_CONNECTIONS, pending.length || 1) }, () => worker()),
    );
    await fh.close().catch(() => undefined);
    await persist();

    if (signal?.aborted) return { outcome: 'aborted', bytesWritten: onDisk(), etag, lastModified };
    const realError = results.find((r): r is PromiseRejectedResult => r.status === 'rejected' && !isAbortError(r.reason));
    if (realError) throw realError.reason instanceof Error ? realError.reason : new Error(String(realError.reason));
    if (onDisk() < total) throw new Error('Parallel download did not complete every segment.');

    await rm(sidecar, { force: true }).catch(() => undefined);
    return { outcome: 'completed', bytesWritten: total, etag, lastModified };
  }

  /** Single-stream ranged download (small files, and the original resumable path). */
  private async downloadSingle(key: string, opts: DownloadOptions): Promise<DownloadResult> {
    const url = await this.directUrl(key);
    const start = opts.rangeStart ?? 0;
    const headers: Record<string, string> = { ...this.authHeaders() };
    if (start > 0) {
      headers.Range = `bytes=${start}-`;
      // If-Range: a strong validator. If the remote changed since the partial was
      // captured, the server replies 200 (full) instead of 206 - our serverStart
      // check then restarts cleanly from 0 rather than appending to stale bytes.
      const validator = opts.ifRange?.etag ?? opts.ifRange?.lastModified;
      if (validator) headers['If-Range'] = validator;
    }

    let res: Response;
    try {
      res = await fetch(url, { headers, signal: opts.signal });
    } catch (e) {
      if (opts.signal?.aborted) return { outcome: 'aborted', bytesWritten: start };
      throw e;
    }
    if (!res.ok && res.status !== 206) throw new Error(`Archive download failed (HTTP ${res.status}).`);
    if (!res.body) throw new Error('Archive download returned an empty body.');

    // Decide resume-vs-restart by VALIDATING the server's actual range start, not
    // by trusting the 206 status alone. A proxy/CDN that satisfies a different
    // range (or returns 200 ignoring Range) must restart cleanly from offset 0 -
    // otherwise body bytes (which begin at the server's start) get written at the
    // requested file offset and silently corrupt the .part.
    const contentRange = res.headers.get('content-range'); // "bytes <s>-<e>/<total>"
    const cr = contentRange ? /bytes\s+(\d+)-(\d+)\/(\d+)/i.exec(contentRange) : null;
    const serverStart = cr ? Number(cr[1]) : null;
    const resumed = start > 0 && res.status === 206 && serverStart === start;
    const effStart = resumed ? start : 0;

    let total: number | null = null;
    if (cr) total = Number(cr[3]);
    else {
      const len = res.headers.get('content-length');
      if (len) total = effStart + Number(len);
    }
    const etag = res.headers.get('etag');
    const lastModified = res.headers.get('last-modified');

    const nodeStream = Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>);
    const writeStream = createWriteStream(opts.destPath, effStart > 0 ? { flags: 'r+', start: effStart } : { flags: 'w' });

    // Count bytes for progress via a Transform IN the pipeline - never a 'data'
    // listener, which would put the source in flowing mode and could drop chunks
    // before the writable attaches. The DURABLE resume offset comes from
    // writeStream.bytesWritten (bytes actually handed to the fd), not this counter.
    let received = effStart;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length;
        opts.onProgress?.({
          bytesReceived: received,
          bytesTotal: total,
          fraction: total ? received / total : null,
          bytesPerSecond: 0,
        });
        cb(null, chunk);
      },
    });

    try {
      // pipeline tears down BOTH streams on error/abort (no fd leak, write side
      // flushed/closed) and surfaces a single completion.
      await pipeline(nodeStream, counter, writeStream, { signal: opts.signal });
    } catch (e) {
      const onDisk = effStart + writeStream.bytesWritten;
      const aborted =
        opts.signal?.aborted ||
        (e as NodeJS.ErrnoException)?.code === 'ABORT_ERR' ||
        (e instanceof Error && e.name === 'AbortError');
      if (aborted) return { outcome: 'aborted', bytesWritten: onDisk, etag, lastModified };
      throw e;
    }
    return { outcome: 'completed', bytesWritten: effStart + writeStream.bytesWritten, etag, lastModified };
  }

  async verify(localPath: string, expected: HashRef): Promise<boolean> {
    return verifyFile(localPath, expected);
  }
}
