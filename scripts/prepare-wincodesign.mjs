// Seeds electron-builder's winCodeSign cache so `electron-builder --win` works on a
// Windows box WITHOUT admin / Developer Mode. electron-builder fetches winCodeSign
// (used for the asar-integrity / signtool tooling) and extracts it with symlink
// restoration; the macOS .dylib symlinks inside fail with "A required privilege is
// not held by the client". We pre-extract the SAME archive EXCLUDING those symlinks
// into the exact cache dir electron-builder looks for, so it skips its failing
// extraction. The Windows signtool (all that's needed here) is preserved. No-op if
// already seeded or on non-Windows.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

if (process.platform !== 'win32') {
  console.log('[prepare-wincodesign] non-Windows host, skipping');
  process.exit(0);
}

const VERSION = 'winCodeSign-2.6.0';
const cacheDir = join(process.env.LOCALAPPDATA ?? '', 'electron-builder', 'Cache', 'winCodeSign', VERSION);

if (existsSync(join(cacheDir, 'windows-10'))) {
  console.log('[prepare-wincodesign] cache already seeded:', cacheDir);
  process.exit(0);
}

const path7za = (await import('7zip-bin')).default.path7za;
const url = `https://github.com/electron-userland/electron-builder-binaries/releases/download/${VERSION}/${VERSION}.7z`;
const archive = join(tmpdir(), `${VERSION}.7z`);

console.log('[prepare-wincodesign] downloading', url);
const res = await fetch(url);
if (!res.ok) throw new Error(`winCodeSign download failed (HTTP ${res.status})`);
writeFileSync(archive, Buffer.from(await res.arrayBuffer()));

mkdirSync(cacheDir, { recursive: true });
// -xr!*.dylib excludes the macOS symlink files that can't be created without privilege.
execFileSync(path7za, ['x', archive, `-o${cacheDir}`, '-xr!*.dylib', '-y'], { stdio: 'inherit' });
console.log('[prepare-wincodesign] seeded', cacheDir);
