// Minimal aria2 JSON-RPC client over the global fetch (talks to the local daemon on
// 127.0.0.1). The RPC secret is passed as the `token:<secret>` first param of every
// call, per aria2's --rpc-secret convention. MAIN PROCESS ONLY.

export type Aria2StatusName = 'active' | 'waiting' | 'paused' | 'error' | 'complete' | 'removed';

export interface Aria2Status {
  gid: string;
  status: Aria2StatusName;
  /** decimal strings (bytes) */
  totalLength: string;
  completedLength: string;
  downloadSpeed: string;
  errorCode?: string;
  errorMessage?: string;
  /** For a magnet: the gid(s) of the actual torrent download spawned once metadata resolves. */
  followedBy?: string[];
  /** Number of connected peers/seeders (BitTorrent). */
  connections?: string;
}

/** One file within a (possibly multi-file) torrent. `index` is 1-based, matching --select-file. */
export interface Aria2File {
  index: string;
  path: string;
  length: string;
  completedLength: string;
  selected: string; // 'true' | 'false'
}

export interface Aria2CallOptions {
  timeoutMs?: number;
  /** Caller's abort signal (pause/cancel) - aborts an in-flight call immediately. */
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * True when an RPC call failed because it TIMED OUT rather than because the daemon is
 * gone. aria2 is single-threaded: while it is blocked writing to disk (the OS zero-fills
 * the gap when parallel connections write at far offsets in a new multi-GB file, which
 * takes ~a minute on a mechanical drive) it stops answering RPC entirely - but it keeps
 * downloading throughout. A timeout therefore means "busy", NOT "failed"; a refused
 * connection (ECONNREFUSED) means the daemon really is gone.
 */
export function isAria2Timeout(e: unknown): boolean {
  const name = (e as Error | undefined)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

export class Aria2Client {
  private seq = 0;

  constructor(
    private readonly endpoint: string,
    private readonly secret: string,
  ) {}

  private async call<T>(method: string, params: unknown[] = [], opts?: Aria2CallOptions): Promise<T> {
    // The caller's signal is merged in so a pause/cancel interrupts an in-flight call
    // instantly instead of waiting out the timeout on a blocked daemon.
    const timeout = AbortSignal.timeout(opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const signal = opts?.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: String(++this.seq),
        method,
        params: [`token:${this.secret}`, ...params],
      }),
    });
    if (!res.ok) throw new Error(`aria2 RPC ${method} failed (HTTP ${res.status})`);
    const json = (await res.json()) as { result?: T; error?: { code: number; message: string } };
    if (json.error) throw new Error(`aria2 RPC ${method}: ${json.error.message} (code ${json.error.code})`);
    return json.result as T;
  }

  getVersion(): Promise<{ version: string }> {
    return this.call('aria2.getVersion');
  }
  addUri(uris: string[], options: Record<string, string>, opts?: Aria2CallOptions): Promise<string> {
    return this.call('aria2.addUri', [uris, options], opts);
  }
  /** Add a .torrent by its base64 bytes. `select-file` in options grabs only chosen files. */
  addTorrent(torrentBase64: string, options: Record<string, string>): Promise<string> {
    return this.call('aria2.addTorrent', [torrentBase64, [], options]);
  }
  /** The torrent's file list with 1-based indices, download progress, and selected flag. */
  getFiles(gid: string): Promise<Aria2File[]> {
    return this.call('aria2.getFiles', [gid]);
  }
  tellStatus(gid: string, keys?: string[], opts?: Aria2CallOptions): Promise<Aria2Status> {
    return this.call('aria2.tellStatus', keys ? [gid, keys] : [gid], opts);
  }
  remove(gid: string): Promise<string> {
    return this.call('aria2.remove', [gid]);
  }
  forceRemove(gid: string): Promise<string> {
    return this.call('aria2.forceRemove', [gid]);
  }
  removeDownloadResult(gid: string): Promise<'OK'> {
    return this.call('aria2.removeDownloadResult', [gid]);
  }
  shutdown(): Promise<'OK'> {
    return this.call('aria2.shutdown');
  }
}
