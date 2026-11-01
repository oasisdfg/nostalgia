// Validates the Native Ports registries against the app's own zod schema
// (src/shared/contracts/recomps.ts, loaded through Node's TypeScript type stripping) and
// fails on duplicate ids or repos. Prints counts per console and status. Run by
// `npm run typecheck`.
//   - src/main/recomps/registry.json  the list bundled with the app
//   - registry/recomps.json           the remote list (must also stay remote-safe)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { recompRegistrySchema } = await import(
  new URL('../src/shared/contracts/recomps.ts', import.meta.url).href
);

let failed = false;
const fail = (msg) => {
  console.error(`[check-registry] ${msg}`);
  failed = true;
};

function check(label, file) {
  const raw = JSON.parse(readFileSync(join(root, file), 'utf8'));
  const parsed = recompRegistrySchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 20)) {
      const at = issue.path.length ? issue.path.join('.') : '(root)';
      const id = typeof issue.path[0] === 'number' ? raw[issue.path[0]]?.id : undefined;
      fail(`${label}: ${id ? `${id}: ` : ''}${at}: ${issue.message}`);
    }
    return [];
  }
  const list = parsed.data;
  for (const key of ['id', 'repo']) {
    const seen = new Map();
    for (const m of list) {
      const v = key === 'repo' ? m.repo.toLowerCase() : m.id;
      if (seen.has(v)) fail(`${label}: duplicate ${key} "${v}" (${seen.get(v)} and ${m.id})`);
      seen.set(v, m.id);
    }
  }
  return list;
}

const bundled = check('bundled', 'src/main/recomps/registry.json');
const remote = check('remote', 'registry/recomps.json');

// The remote list may not carry kinds of port that decide what runs on the user's PC
// (mirrors remoteMayCarry in src/main/recomps/registry.ts).
for (const m of remote) {
  if (m.build || m.assetKind === 'exe' || m.assetKind === 'external' || m.gameFile.source === 'pick') {
    fail(`remote: ${m.id} is a bundled-only kind of port (build/exe/external/pick)`);
  }
}

const byConsole = {};
const byStatus = {};
for (const m of bundled) {
  byConsole[m.gameFile.systemSlug] = (byConsole[m.gameFile.systemSlug] ?? 0) + 1;
  byStatus[m.status] = (byStatus[m.status] ?? 0) + 1;
}
console.log(`[check-registry] bundled: ${bundled.length} ports; remote: ${remote.length}`);
console.log(
  `[check-registry] by console: ${Object.entries(byConsole)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(', ')}`,
);
console.log(`[check-registry] by status: ${Object.entries(byStatus).map(([k, v]) => `${k} ${v}`).join(', ')}`);
if (failed) process.exit(1);
