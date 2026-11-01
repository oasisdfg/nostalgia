// Dev-only (not shipped): looks up each Native Port's ORIGINAL game on IGDB and fills in
// `igdbId`, used for port art. Searches originalTitle on the console's IGDB platform and
// accepts only an exact title match (case, accents and punctuation ignored); anything less
// is left without an igdbId and listed for a human to check.
//   node scripts/dev/igdb-ids.mjs          report only
//   node scripts/dev/igdb-ids.mjs --write  also write igdbId into both registry files
// Reads IGDB_CLIENT_ID / IGDB_CLIENT_SECRET from the repo-root .env (never printed).
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = Object.fromEntries(
  readFileSync(join(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
);
const clientId = env.IGDB_CLIENT_ID;
const secret = env.IGDB_CLIENT_SECRET;
if (!clientId || !secret) throw new Error('IGDB_CLIENT_ID / IGDB_CLIENT_SECRET missing from .env');

// Console slug -> IGDB platform id (mirrors IGDB_PLATFORM_BY_SLUG, plus PS4 for ports).
const PLATFORM = { n64: 4, ps1: 7, ps2: 8, ps4: 48, psp: 38, xbox: 11, xbox360: 12, gamecube: 21, wii: 5, wiiu: 41, switch: 130 };

const tokenRes = await fetch(
  `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(secret)}&grant_type=client_credentials`,
  { method: 'POST' },
);
if (!tokenRes.ok) throw new Error(`Twitch token request failed (${tokenRes.status})`);
const { access_token: token } = await tokenRes.json();

const norm = (s) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');

async function search(title, platform) {
  const body = `search "${title.replace(/"/g, '')}"; fields id,name,alternative_names.name; where platforms = (${platform}); limit 10;`;
  const res = await fetch('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
    body,
  });
  if (!res.ok) throw new Error(`IGDB ${res.status}`);
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bundledPath = join(root, 'src/main/recomps/registry.json');
const remotePath = join(root, 'registry/recomps.json');
const bundled = JSON.parse(readFileSync(bundledPath, 'utf8'));
const found = {};
const unmatched = [];

for (const m of bundled) {
  const platform = PLATFORM[m.gameFile.systemSlug];
  if (!platform) {
    unmatched.push(`${m.id}: no IGDB platform for ${m.gameFile.systemSlug}`);
    continue;
  }
  const want = norm(m.originalTitle);
  const results = await search(m.originalTitle, platform);
  await sleep(260); // IGDB allows 4 requests a second
  const hit = results.find(
    (g) => norm(g.name) === want || (g.alternative_names ?? []).some((a) => norm(a.name) === want),
  );
  if (hit) {
    found[m.id] = hit.id;
    if (m.igdbId != null && m.igdbId !== hit.id) unmatched.push(`${m.id}: registry has ${m.igdbId}, IGDB match is ${hit.id}`);
  } else {
    unmatched.push(`${m.id}: "${m.originalTitle}" -> ${results.slice(0, 3).map((g) => `${g.name} (${g.id})`).join('; ') || 'no results'}`);
  }
}

console.log(`matched ${Object.keys(found).length} of ${bundled.length}`);
for (const line of unmatched) console.log(`  unmatched ${line}`);

if (process.argv.includes('--write')) {
  for (const path of [bundledPath, remotePath]) {
    const list = JSON.parse(readFileSync(path, 'utf8'));
    for (const m of list) if (found[m.id] != null && m.igdbId == null) m.igdbId = found[m.id];
    writeFileSync(path, JSON.stringify(list, null, 2) + '\n');
  }
  console.log('wrote igdbId into both registries');
}
