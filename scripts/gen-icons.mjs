// Rasterizes resources/icon.svg into a multi-resolution PNG set + a Windows .ico.
// Uses prebuilt (N-API) resvg — no native compile. Run via `npm run icons`.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import pngToIco from 'png-to-ico';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const svg = readFileSync(join(root, 'resources', 'icon.svg'), 'utf8');
const outDir = join(root, 'resources', 'icons');
mkdirSync(outDir, { recursive: true });

const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngPaths = [];
for (const size of sizes) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  const path = join(outDir, `icon-${size}.png`);
  writeFileSync(path, png);
  pngPaths.push(path);
  console.log(`wrote ${path} (${png.length} bytes)`);
}

// Canonical 256px PNG at resources/icon.png (used by electron-builder + the window).
writeFileSync(join(root, 'resources', 'icon.png'), readFileSync(join(outDir, 'icon-256.png')));

// Multi-resolution Windows .ico.
const ico = await pngToIco(pngPaths);
writeFileSync(join(root, 'resources', 'icon.ico'), ico);
console.log(`wrote resources/icon.ico (${ico.length} bytes)`);
