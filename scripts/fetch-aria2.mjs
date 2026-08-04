// Fetches the aria2 Windows binary (aria2c.exe) that the app spawns as its download
// engine, verifies it against a pinned SHA-256, and drops it + its GPL license into
// resources/aria2/. Bundled at package time via electron-builder `extraResources`.
// aria2 is GPLv2+ and is invoked as a SEPARATE PROCESS (aggregation, not linking), so
// the app's own license is unaffected — we ship its COPYING for compliance.
// No-op if already present. Mirrors scripts/prepare-wincodesign.mjs's fetch+7za pattern.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const VERSION = '1.37.0';
const ZIP_SHA256 = '67d015301eef0b612191212d564c5bb0a14b5b9c4796b76454276a4d28d9b288';
const URL = `https://github.com/aria2/aria2/releases/download/release-${VERSION}/aria2-${VERSION}-win-64bit-build1.zip`;

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'aria2');
const exePath = join(outDir, 'aria2c.exe');

if (existsSync(exePath)) {
  console.log('[fetch-aria2] already present:', exePath);
  process.exit(0);
}

console.log('[fetch-aria2] downloading', URL);
const res = await fetch(URL);
if (!res.ok) throw new Error(`aria2 download failed (HTTP ${res.status})`);
const buf = Buffer.from(await res.arrayBuffer());

const digest = createHash('sha256').update(buf).digest('hex');
if (digest !== ZIP_SHA256) {
  throw new Error(`aria2 checksum mismatch: expected ${ZIP_SHA256}, got ${digest}`);
}
console.log('[fetch-aria2] checksum OK');

const archive = join(tmpdir(), `aria2-${VERSION}-win-64bit-build1.zip`);
writeFileSync(archive, buf);

mkdirSync(outDir, { recursive: true });
const path7za = (await import('7zip-bin')).default.path7za;
// `e` extracts flat (drops the archive's inner subdir); `-r` finds the files nested inside it.
execFileSync(path7za, ['e', archive, `-o${outDir}`, '-y', '-r', 'aria2c.exe', 'COPYING'], { stdio: 'inherit' });

if (!existsSync(exePath)) throw new Error('aria2c.exe not found after extraction');
console.log('[fetch-aria2] installed', exePath);
