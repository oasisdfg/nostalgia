import { createReadStream, createWriteStream } from 'node:fs';
import { stat as fsStat, readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
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

// Saves live under <root>/.saves (managed by the SaveSyncProvider); skip it in list().
const SAVES_DIR = '.saves';
const MANIFEST = 'manifest.json';

/**
 * Ship-now StorageProvider backed by a local folder (storage.root). Satisfies the
 * provider-agnostic interface so a real cloud/HTTP provider can drop in later.
 * Supports ranged copies (resume) and an optional hash manifest. (Save-sync is a
 * separate SaveSyncProvider abstraction - see src/main/saves.)
 */
export class LocalFolderStorageProvider implements StorageProvider {
  constructor(private readonly root: string) {}

  getCapabilities(): ProviderCapabilities {
    return {
      providerId: 'local-folder',
      supportsRanged: true,
      supportsHashManifest: true,
      supportsDirectUrl: true,
    };
  }

  private resolve(key: string): string {
    return join(this.root, ...key.split('/'));
  }

  async list(prefix?: string): Promise<RemoteEntry[]> {
    const out: RemoteEntry[] = [];
    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name === SAVES_DIR) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile() && entry.name !== MANIFEST) {
          const key = relative(this.root, full).split(sep).join('/');
          if (prefix && !key.startsWith(prefix)) continue;
          const st = await fsStat(full);
          out.push({ key, isDirectory: false, sizeBytes: st.size });
        }
      }
    };
    await walk(this.root);
    return out;
  }

  private async readManifest(): Promise<Record<string, HashRef[]>> {
    try {
      const raw = await readFile(join(this.root, MANIFEST), 'utf8');
      const parsed = JSON.parse(raw) as Record<string, HashRef[]>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  async stat(key: string): Promise<RemoteStat> {
    const st = await fsStat(this.resolve(key));
    const manifest = await this.readManifest();
    return { key, sizeBytes: st.size, hashes: manifest[key] ?? [] };
  }

  async getDownloadUrl(key: string): Promise<string> {
    return pathToFileURL(this.resolve(key)).toString();
  }

  async download(key: string, opts: DownloadOptions): Promise<DownloadResult> {
    const src = this.resolve(key);
    const total = (await fsStat(src)).size;
    const start = opts.rangeStart ?? 0;

    return await new Promise<DownloadResult>((resolve, reject) => {
      if (opts.signal?.aborted) {
        resolve({ outcome: 'aborted', bytesWritten: start });
        return;
      }
      const readStream = createReadStream(src, { start });
      const writeStream = createWriteStream(opts.destPath, start > 0 ? { flags: 'r+', start } : { flags: 'w' });
      let received = start;
      let settled = false;
      const finish = (result: DownloadResult): void => {
        if (settled) return;
        settled = true;
        opts.signal?.removeEventListener('abort', onAbort);
        resolve(result);
      };
      const onAbort = (): void => {
        readStream.destroy();
        writeStream.destroy();
        finish({ outcome: 'aborted', bytesWritten: received });
      };
      opts.signal?.addEventListener('abort', onAbort, { once: true });

      readStream.on('data', (chunk: Buffer | string) => {
        received += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
        opts.onProgress?.({
          bytesReceived: received,
          bytesTotal: total,
          fraction: total > 0 ? received / total : null,
          bytesPerSecond: 0,
        });
      });
      readStream.on('error', (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
      writeStream.on('error', (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
      writeStream.on('finish', () => finish({ outcome: 'completed', bytesWritten: received }));
      readStream.pipe(writeStream);
    });
  }

  async verify(localPath: string, expected: HashRef): Promise<boolean> {
    return verifyFile(localPath, expected);
  }
}
