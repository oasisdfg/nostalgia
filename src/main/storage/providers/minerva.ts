// Minerva Archive StorageProvider - a TORRENT-backed source. Minerva distributes each
// Redump console set as ONE big multi-file torrent (per-game .zip members); we fetch the
// collection's static .torrent, parse its file list, and use the bundled aria2's
// --select-file to pull exactly ONE game out of the thousands without downloading the
// rest (see aria2/torrent.ts). Matching reuses the SAME normalizeTitle/pickPreferred logic
// as the Internet Archive provider, so USA-first region selection + demo exclusion are
// identical. Downloaded files are per-game .zips → the DownloadManager extracts them like
// the other Redump sets. MAIN PROCESS ONLY.
import { app } from 'electron';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  StorageProvider,
  ProviderCapabilities,
  RemoteEntry,
  RemoteStat,
  DownloadOptions,
  DownloadResult,
  HashRef,
} from '@shared/contracts/storage';
import { parseTorrent, downloadTorrentViaAria2, type TorrentFile } from '../aria2/torrent';
import { normalizeTitle, pickPreferred } from '../../catalog/archiveMatch';
import { verifyFile } from '../hashing';
import type { ArchiveMatch } from './archiveOrg';

// Same rule as archiveOrg: demos/prototypes/betas share the retail title's normalized name
// and must not collide with it (→ ambiguous → dropped, so the real game loses its match).
const AUX_RELEASE_RE = /\([^)]*\b(?:demo|proto(?:type)?|beta|sample|kiosk|trial|preview|promo)\b[^)]*\)/i;

/**
 * Ceiling for fetching a collection torrent. minerva-archive.org serves these SLOWLY -
 * the PS3 set is 12.5 MB at ~250 KB/s, i.e. ~50s measured - so the limit is generous, but
 * it MUST exist: `catalog:availability` runs this on a passive page open, and with no
 * timeout at all a stalled host left the game page spinning on "Retrieving…" indefinitely
 * (and eventually surfaced a bare "fetch failed"). The parsed torrent is cached on disk,
 * so this cost is paid once per collection, not per lookup.
 */
const TORRENT_FETCH_TIMEOUT_MS = 120_000;

export class MinervaStorageProvider implements StorageProvider {
  private loaded: Promise<void> | null = null;
  private torrentBuf: Buffer | null = null;
  private byKey = new Map<string, TorrentFile>(); // storage_key (torrent file path) -> file
  private matchIndex = new Map<string, TorrentFile>(); // normalized title -> best file

  constructor(
    private readonly collection: string,
    private readonly torrentUrl: string,
    private readonly opts: { extensions: string[] },
  ) {}

  getCapabilities(): ProviderCapabilities {
    return {
      providerId: 'minerva',
      // A torrent is fetched as a whole selected file; there is no HTTP byte-range resume.
      // aria2 self-resumes mid-transfer via its .aria2 control file; a paused/canceled job
      // restarts the selected file from 0 (see download()).
      supportsRanged: false,
      supportsHashManifest: false,
      supportsDirectUrl: false,
    };
  }

  private torrentCachePath(): string {
    const safe = this.collection.replace(/[^a-z0-9]+/gi, '_');
    return join(app.getPath('userData'), 'minerva', `${safe}.torrent`);
  }

  /** Downloads the collection torrent, bounded and retried once. */
  private async fetchTorrent(): Promise<Buffer> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(this.torrentUrl, { signal: AbortSignal.timeout(TORRENT_FETCH_TIMEOUT_MS) });
        if (!res.ok) throw new Error(`Minerva torrent fetch failed (HTTP ${res.status}).`);
        return Buffer.from(await res.arrayBuffer());
      } catch (e) {
        lastErr = e; // one slow/reset transfer from this host is common - try once more
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Minerva torrent fetch failed.');
  }

  /** Fetch (cached) + parse the collection torrent and build the match index. */
  private ensure(): Promise<void> {
    if (!this.loaded) {
      this.loaded = (async () => {
        const cachePath = this.torrentCachePath();
        let buf: Buffer | null = null;
        let info: ReturnType<typeof parseTorrent> | null = null;

        if (existsSync(cachePath)) {
          // A cache file that no longer parses (truncated write, or an HTML error page
          // saved as a torrent) would otherwise fail on every lookup forever - drop it
          // and refetch instead.
          buf = await readFile(cachePath);
          try {
            info = parseTorrent(buf);
          } catch {
            await rm(cachePath, { force: true }).catch(() => undefined);
            buf = null;
          }
        }

        if (!buf) {
          buf = await this.fetchTorrent();
          // Parse BEFORE caching so only a torrent we can actually read is persisted, and
          // write via a temp file so an interrupted write can't leave a half torrent behind.
          info = parseTorrent(buf);
          const tmp = `${cachePath}.part`;
          await mkdir(join(app.getPath('userData'), 'minerva'), { recursive: true });
          await writeFile(tmp, buf);
          await rename(tmp, cachePath);
        }

        if (!info) throw new Error('Minerva torrent could not be parsed.');
        this.torrentBuf = buf;
        const extRe = new RegExp(`\\.(${this.opts.extensions.join('|')})$`, 'i');
        const playable = info.files.filter((f) => extRe.test(f.path) && !AUX_RELEASE_RE.test(f.path));
        // Group same-normalized-title files (region/revision variants of one game) and pick
        // one (USA-first, latest rev) - identical to the archive provider's index.
        const groups = new Map<string, TorrentFile[]>();
        for (const f of playable) {
          this.byKey.set(f.path, f);
          const key = normalizeTitle(f.path, this.opts);
          const g = groups.get(key);
          if (g) g.push(f);
          else groups.set(key, [f]);
        }
        for (const [key, group] of groups) {
          const best = pickPreferred(group.map((f) => ({ ...f, name: f.path })), key);
          if (best) this.matchIndex.set(key, best);
        }
      })().catch((e: unknown) => {
        this.loaded = null; // allow retry on next call
        throw e;
      });
    }
    return this.loaded;
  }

  async list(): Promise<RemoteEntry[]> {
    await this.ensure();
    return [...this.byKey.values()].map((f) => ({ key: f.path, isDirectory: false, sizeBytes: f.length }));
  }

  async stat(key: string): Promise<RemoteStat> {
    await this.ensure();
    // Torrent piece hashes guarantee integrity, so no per-file md5 is exposed here.
    return { key, sizeBytes: this.byKey.get(key)?.length ?? 0, hashes: [] };
  }

  async getDownloadUrl(): Promise<string> {
    throw new Error('Minerva is a torrent source - there is no direct download URL.');
  }

  async verify(localPath: string, expected: HashRef): Promise<boolean> {
    return verifyFile(localPath, expected);
  }

  /** High-confidence title match (returns the torrent file PATH as the opaque storage_key). */
  async matchTitle(title: string): Promise<ArchiveMatch | null> {
    await this.ensure();
    const f = this.matchIndex.get(normalizeTitle(title, this.opts));
    return f ? { filename: f.path, sizeBytes: f.length, md5: null } : null;
  }

  async download(key: string, opts: DownloadOptions): Promise<DownloadResult> {
    await this.ensure();
    const file = this.byKey.get(key);
    if (!file || !this.torrentBuf) throw new Error(`Minerva: "${key}" is not in the ${this.collection} torrent.`);
    // Torrents write <dir>/<torrent name>/<file path>, not a caller-named file, so download
    // into a scratch dir beside the .part and move the one selected file out afterwards.
    const workDir = `${opts.destPath}.tdir`;
    await mkdir(workDir, { recursive: true });
    try {
      const res = await downloadTorrentViaAria2(this.torrentBuf, {
        dir: workDir,
        selectIndices: [file.index],
        signal: opts.signal,
        onProgress: (p) =>
          opts.onProgress?.({
            bytesReceived: p.bytesReceived,
            bytesTotal: p.bytesTotal,
            fraction: p.fraction,
            bytesPerSecond: p.bytesPerSecond,
          }),
      });
      if (!res) throw new Error('Minerva: aria2 is unavailable.');
      if (res.outcome !== 'completed' || res.files.length === 0) {
        // Non-ranged: a paused/canceled torrent restarts the selected file from 0.
        return { outcome: 'aborted', bytesWritten: 0 };
      }
      await rename(res.files[0], opts.destPath);
      return { outcome: 'completed', bytesWritten: res.bytesWritten };
    } finally {
      // Always drop the scratch tree (empty after the move on success; partial + .aria2
      // control file on abort - a restart from 0 is fine for a non-ranged source).
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
