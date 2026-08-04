// Fetches prebuilt native binaries (better-sqlite3) for the installed Electron
// version, so no local C++ toolchain (and no ClangCL) is required on Windows.
// Run via `npm run rebuild`.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const electronPkg = join(root, 'node_modules', 'electron', 'package.json');
const electronVersion = JSON.parse(readFileSync(electronPkg, 'utf8')).version;
const bsqDir = join(root, 'node_modules', 'better-sqlite3');
const binJs = join(root, 'node_modules', 'prebuild-install', 'bin.js');

console.log(`[fetch-native] better-sqlite3 -> electron ${electronVersion} (${process.arch})`);
const res = spawnSync(
  process.execPath,
  [binJs, '-r', 'electron', '-t', electronVersion, '--arch', process.arch],
  { cwd: bsqDir, stdio: 'inherit' },
);
process.exit(res.status ?? 1);
