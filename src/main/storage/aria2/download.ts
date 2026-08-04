// Downloads a URL to a destination via the aria2 daemon (multi-connection). aria2 owns
// the output file AND its `<destPath>.aria2` control file, so a re-entered call (the
// manager's resume) just re-adds the URI and aria2 continues from that control file -
// the manager's rangeStart is intentionally ignored here (same as the built-in parallel
// path). Returns null when aria2 is unavailable so the caller can fall back. MAIN ONLY.
import { basename, dirname } from 'node:path';
import type { DownloadOptions, DownloadResult } from '@shared/contracts/storage';
import { ensureAria2 } from './daemon';
import { isAria2Timeout, type Aria2Client } from './rpcClient';

const POLL_MS = 500;
// How long the daemon may stay unresponsive before we give up on it.
//
// BUSY: aria2 is single-threaded, so while the OS is zero-filling the gap that parallel
// ranged connections open in a new multi-GB file it answers no RPC at all - measured at
// ~55s for an 8.5 GB ISO on a 7200rpm HDD, and it scales with file size. It keeps
// downloading the whole time, so a timeout must NOT fail the transfer. (The old rule -
// 5 consecutive 10s timeouts - killed exactly these downloads, force-removing a gid that
// was actively receiving bytes.) Cancel/pause still interrupts instantly because the
// caller's signal is merged into every RPC call.
const BUSY_GRACE_MS = 15 * 60_000;
// DEAD: a refused connection means the daemon is really gone; it isn't coming back, so
// only absorb a brief restart window before failing over to the built-in downloader.
const DEAD_GRACE_MS = 20_000;
const STATUS_KEYS = ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'errorCode', 'errorMessage'];
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function downloadViaAria2(
  urls: string | string[],
  opts: DownloadOptions,
  extraOptions?: Record<string, string>,
): Promise<DownloadResult | null> {
  const client = await ensureAria2();
  if (!client) return null;

  const uris = Array.isArray(urls) ? urls : [urls];
  const { destPath, signal, onProgress } = opts;
  // aria2 caps connections at 16 PER SERVER - multiple mirror URIs raise the total
  // (2 mirrors → up to 32 connections), so split scales with the mirror count.
  const gid = await client.addUri(
    uris,
    {
      dir: dirname(destPath),
      out: basename(destPath),
      split: String(16 * uris.length),
      'max-connection-per-server': '16',
      'min-split-size': '1M',
      continue: 'true',
      // The manager owns this exact path. If the .part exists WITHOUT a control file
      // (leftover from the fallback engine or a crash), restart over it in place -
      // never auto-rename to `<out>.1`, which would leave the manager verifying and
      // promoting a stale file while aria2 fills a sibling nobody looks at.
      'allow-overwrite': 'true',
      'auto-file-renaming': 'false',
      // archive.org mirrors flake transiently; retry generously before giving up.
      'max-tries': '10',
      'retry-wait': '2',
      ...extraOptions,
    },
    // A queued addUri can land while the daemon is still blocked finishing the previous
    // transfer's writes, so it gets busy tolerance too (and honors cancel).
    { timeoutMs: 60_000, signal },
  );

  let completed = 0;
  let unresponsiveSince: number | null = null;
  try {
    for (;;) {
      if (signal?.aborted) {
        await stop(client, gid);
        return { outcome: 'aborted', bytesWritten: completed };
      }
      let st;
      try {
        st = await client.tellStatus(gid, STATUS_KEYS, { signal });
        unresponsiveSince = null;
      } catch (pollErr) {
        // The user pausing/cancelling aborts the in-flight call - that's not a failure.
        if (signal?.aborted) {
          await stop(client, gid);
          return { outcome: 'aborted', bytesWritten: completed };
        }
        // Busy (timeout) vs gone (connection refused) get very different patience: the
        // transfer survives the former and is unrecoverable in the latter.
        unresponsiveSince ??= Date.now();
        const grace = isAria2Timeout(pollErr) ? BUSY_GRACE_MS : DEAD_GRACE_MS;
        if (Date.now() - unresponsiveSince >= grace) throw pollErr;
        await sleep(POLL_MS);
        continue;
      }
      completed = Number(st.completedLength) || completed;
      const total = Number(st.totalLength) || null;
      onProgress?.({
        bytesReceived: completed,
        bytesTotal: total,
        fraction: total ? completed / total : null,
        bytesPerSecond: Number(st.downloadSpeed) || 0,
      });
      if (st.status === 'complete') {
        await client.removeDownloadResult(gid).catch(() => undefined);
        return { outcome: 'completed', bytesWritten: total ?? completed };
      }
      if (st.status === 'error') {
        await client.removeDownloadResult(gid).catch(() => undefined);
        throw new Error(st.errorMessage || `aria2 download failed (code ${st.errorCode ?? '?'})`);
      }
      if (st.status === 'removed') return { outcome: 'aborted', bytesWritten: completed };
      await sleep(POLL_MS);
    }
  } catch (e) {
    if (signal?.aborted) {
      await stop(client, gid);
      return { outcome: 'aborted', bytesWritten: completed };
    }
    // Don't leave the transfer running headless on an unrecoverable error.
    await stop(client, gid);
    throw e;
  }
}

/** Stop + forget the gid; the on-disk `.aria2` control file persists for resume. */
async function stop(client: Aria2Client, gid: string): Promise<void> {
  await client.remove(gid).catch(() => client.forceRemove(gid).catch(() => undefined));
  await client.removeDownloadResult(gid).catch(() => undefined);
}
