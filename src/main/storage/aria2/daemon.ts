// Lifecycle for the single aria2c RPC daemon the app spawns as its download engine.
// Lazily started on first use, health-checked, memoized; auto-exits with Electron via
// --stop-with-process and is also killed explicitly on before-quit. If the binary is
// missing or the daemon never comes up, ensureAria2() resolves null and callers fall
// back to the built-in downloader. MAIN PROCESS ONLY.
import { app } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { aria2BinaryPath } from './binary';
import { Aria2Client } from './rpcClient';

let child: ChildProcess | null = null;
let clientPromise: Promise<Aria2Client | null> | null = null;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Ask the OS for a free localhost TCP port. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error('no free port'))));
    });
  });
}

/** Returns a ready RPC client, or null if aria2 is unavailable (caller falls back). */
export function ensureAria2(): Promise<Aria2Client | null> {
  if (!clientPromise) clientPromise = start();
  return clientPromise;
}

async function start(): Promise<Aria2Client | null> {
  const bin = aria2BinaryPath();
  if (!bin) {
    if (!app.isPackaged) console.warn('[aria2] binary not found - using the built-in downloader');
    return null; // memoized: don't re-probe every download
  }
  try {
    const port = await freePort();
    const secret = randomUUID();
    const proc = spawn(
      bin,
      [
        '--enable-rpc',
        '--rpc-listen-all=false',
        `--rpc-listen-port=${port}`,
        `--rpc-secret=${secret}`,
        `--stop-with-process=${process.pid}`, // auto-exit if Electron dies
        '--continue=true',
        '--auto-save-interval=1', // fresh .aria2 control file for resume
        // falloc = instant preallocation on NTFS: contiguous file, steadier write
        // throughput on multi-GB ISOs than growing the file as pieces land.
        '--file-allocation=falloc',
        // Larger in-memory write cache (default 16M): fewer, bigger disk flushes so
        // 16 parallel streams aren't stalled on small scattered writes.
        '--disk-cache=64M',
        '--check-certificate=true',
        // --- BitTorrent (torrent/magnet sources like Minerva) ---
        // aria2 IS a full BT client; enabling DHT + LPD + PEX lets it find peers without
        // any external program. Listen ports are left to aria2's defaults (6881-6999).
        '--enable-dht=true',
        '--enable-dht6=false',
        '--bt-enable-lpd=true',
        '--enable-peer-exchange=true',
        '--dht-entry-point=router.bittorrent.com:6881',
        // Leecher defaults for a download tool: stop the instant the file is complete and
        // strip files we didn't --select-file so a partial pull of a huge collection
        // torrent doesn't leave placeholders. Per-download options can still override.
        '--seed-time=0',
        '--bt-remove-unselected-file=true',
        '--bt-save-metadata=true',
        '--console-log-level=warn',
        '--quiet=true',
      ],
      { stdio: 'ignore', windowsHide: true },
    );
    child = proc;
    proc.once('exit', () => {
      if (child === proc) {
        child = null;
        clientPromise = null; // allow a restart on the next download
      }
    });

    const client = new Aria2Client(`http://127.0.0.1:${port}/jsonrpc`, secret);
    for (let i = 0; i < 50 && child === proc; i++) {
      try {
        await client.getVersion();
        if (!app.isPackaged) console.log('[aria2] daemon ready on 127.0.0.1:' + port);
        return client;
      } catch {
        await sleep(100);
      }
    }
    console.error('[aria2] daemon did not become ready - using the built-in downloader');
    shutdownAria2();
    return null;
  } catch (e) {
    console.error('[aria2] failed to start:', e);
    shutdownAria2();
    return null;
  }
}

/** Kill the daemon and reset state (wired into app before-quit). */
export function shutdownAria2(): void {
  const proc = child;
  child = null;
  clientPromise = null;
  if (proc && !proc.killed) {
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  }
}
