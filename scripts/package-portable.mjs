// Assembles a portable Windows build (dist/win-unpacked) by combining the
// Electron runtime with the built app + the prebuilt native module + icon.
// This needs no code-signing tools (unlike `electron-builder`, whose winCodeSign
// step requires symlink privileges / Developer Mode on Windows).
import { cpSync, mkdirSync, rmSync, renameSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'dist', 'win-unpacked');

rmSync(join(root, 'dist'), { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

cpSync(join(root, 'node_modules', 'electron', 'dist'), dist, { recursive: true });
renameSync(join(dist, 'electron.exe'), join(dist, 'Nostalgia.exe'));

const app = join(dist, 'resources', 'app');
mkdirSync(join(app, 'node_modules'), { recursive: true });
cpSync(join(root, 'out'), join(app, 'out'), { recursive: true });
cpSync(join(root, 'package.json'), join(app, 'package.json'));
for (const m of ['better-sqlite3', 'bindings', 'file-uri-to-path']) {
  const src = join(root, 'node_modules', m);
  if (existsSync(src)) cpSync(src, join(app, 'node_modules', m), { recursive: true });
}
mkdirSync(join(app, 'resources'), { recursive: true });
cpSync(join(root, 'resources', 'icon.ico'), join(app, 'resources', 'icon.ico'));
cpSync(join(root, 'resources', 'icon.png'), join(app, 'resources', 'icon.png'));

// Spawned helpers live in <resources>/ (process.resourcesPath), outside the app folder.
const sevenZip = join(root, 'resources', '7zip');
if (existsSync(sevenZip)) cpSync(sevenZip, join(dist, 'resources', '7zip'), { recursive: true });

console.log(`Portable build ready: ${join(dist, 'Nostalgia.exe')}`);
