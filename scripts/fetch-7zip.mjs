// Puts 7-Zip's standalone console exe (7za.exe) into resources/7zip/, which the app spawns
// to unpack Native Ports released as .7z (yauzl covers .zip). The binary comes from the
// `7zip-bin` package electron-builder already installs (the official 7-Zip 7za build, the
// same one scripts/fetch-aria2.mjs uses), so this adds no dependency and no download.
// Bundled at package time via electron-builder `extraResources`. 7-Zip is LGPL and runs as a
// separate process. No-op if already present.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', '7zip');
const exePath = join(outDir, '7za.exe');

if (existsSync(exePath)) {
  console.log('[fetch-7zip] already present:', exePath);
  process.exit(0);
}

const { path7za } = (await import('7zip-bin')).default;
if (!existsSync(path7za)) throw new Error(`7zip-bin's 7za.exe not found at ${path7za}`);
mkdirSync(outDir, { recursive: true });
copyFileSync(path7za, exePath);
console.log('[fetch-7zip] installed', exePath);
