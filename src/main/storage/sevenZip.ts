import { app } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Absolute path to the bundled 7za.exe, or null if it isn't present. Packaged it lives at
 * `<resources>/7zip/7za.exe` (electron-builder `extraResources`, outside the asar so it's
 * spawnable); in dev it's the repo's `resources/7zip/7za.exe` (scripts/fetch-7zip.mjs).
 * MAIN PROCESS ONLY.
 */
export function sevenZipBinaryPath(): string | null {
  const path = app.isPackaged
    ? join(process.resourcesPath, '7zip', '7za.exe')
    : join(app.getAppPath(), 'resources', '7zip', '7za.exe');
  return existsSync(path) ? path : null;
}

/**
 * Extracts a .7z archive into `destDir` (inner folders preserved). Spawned with an argv
 * array, never a shell; 7-Zip itself refuses entries that would escape the target. Reports
 * 0..1 progress from 7-Zip's own percentage output.
 */
export async function extract7z(
  archive: string,
  destDir: string,
  opts: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {},
): Promise<void> {
  const exe = sevenZipBinaryPath();
  if (!exe) throw new Error('7-Zip is missing from this install.');
  await mkdir(destDir, { recursive: true });
  // `-o<dir>` is one argv element by 7-Zip's own syntax (no space allowed), not a command line.
  const child = spawn(exe, ['x', archive, `-o${destDir}`, '-y', '-bso0', '-bsp1'], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    signal: opts.signal,
  });
  child.stdout.on('data', (chunk: Buffer) => {
    const all = chunk.toString().match(/(\d{1,3})%/g);
    if (all && opts.onProgress) opts.onProgress(Math.min(100, Number(all[all.length - 1].slice(0, -1))) / 100);
  });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  if (code !== 0) throw new Error(`7-Zip failed (${code})${stderr ? `: ${stderr.trim().split(/\r?\n/).pop()}` : ''}`);
}
