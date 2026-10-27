// Dev-only end-to-end check of the storage/download/cache subsystem. Runs only
// under NOSTALGIA_SMOKE against the in-memory DB + a disposable temp folder.
import { app } from 'electron';
import { join } from 'node:path';
import { mkdir, writeFile, readFile, rm, statfs, open, stat as fsStat } from 'node:fs/promises';
import { getDb } from '../db/connection';
import { upsertArchiveFile, setCacheState } from '../db/repositories/gameFilesRepo';
import { listDownloadItems } from '../db/repositories/downloadsRepo';
import { getEntryByFile } from '../db/repositories/cacheRepo';
import { setSetting } from '../db/repositories/settingsRepo';
import { scanLibrary } from '../storage/ingest';
import { scanSystemFolder } from '../storage/folderScan';
import * as downloadManager from '../storage/downloadManager';
import * as cache from '../storage/cache';
import { resolveArgs } from '../launch/tokens';
import { createEmulator } from '../db/repositories/emulatorsRepo';
import { setSystemEmulator } from '../db/repositories/systemEmulatorRepo';
import { launch } from '../launch/launcher';
import { buildGamesQuery, igdbImageUrl, acquireSlot } from '../catalog/igdbClient';
import { hasCredentials } from '../catalog/credentials';
import { igdbProvider } from '../catalog/igdbProvider';
import { enqueueScrapeJob } from '../db/repositories/scrapeJobsRepo';
import { processJob } from '../metadata/scrapeWorker';
import { denormalizeOntoGame, setMetadataLocked } from '../db/repositories/metadataRepo';
import { upsertSave, getSaveRowsForGame, deleteSaveRow } from '../db/repositories/savesRepo';
import { syncGame } from '../saves/syncEngine';
import { getSaveSyncProvider } from '../saves';
import { hashFile } from '../storage/hashing';
import { getArchiveProvider } from '../catalog/archiveSources';
import { SEGMENT_SIZE } from '../storage/providers/archiveOrg';
import { ensureAria2 } from '../storage/aria2/daemon';
import { fetchTorrentMetadata, parseTorrent, downloadTorrentViaAria2 } from '../storage/aria2/torrent';
import { normalizeTitle } from '../catalog/archiveMatch';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function runStorageSmoke(): Promise<void> {
  const base = join(app.getPath('userData'), 'smoke');
  const storageRoot = join(base, 'storage');
  const cacheDir = join(base, 'cache');
  await mkdir(storageRoot, { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  await writeFile(join(storageRoot, 'TestGame.rom'), 'NOSTALGIA TEST ROM CONTENT');

  setSetting('storage.root', storageRoot);
  setSetting('cache.dir', cacheDir);
  setSetting('cache.sizeLimitBytes', 10 * 1024 * 1024);

  const sys = getDb().prepare('SELECT id FROM systems ORDER BY sort_order LIMIT 1').get() as { id: number };
  const scan = await scanLibrary(sys.id);
  const file = getDb().prepare('SELECT id, cache_state FROM game_files LIMIT 1').get() as {
    id: number;
    cache_state: string;
  };
  console.log('[smoke] ingest added', scan.added, 'cacheState', file.cache_state);

  downloadManager.enqueue(file.id, 10);
  await downloadManager.awaitCompletion(file.id);

  const after = getDb().prepare('SELECT cache_state, hash_source, sha1 FROM game_files WHERE id = ?').get(file.id) as {
    cache_state: string;
    hash_source: string;
    sha1: string | null;
  };
  const stats = cache.stats();
  console.log(
    '[smoke] downloaded cacheState',
    after.cache_state,
    'hashSource',
    after.hash_source,
    'cacheEntries',
    stats.entryCount,
    'bytes',
    stats.totalBytes,
  );
  if (after.cache_state !== 'cached' || stats.entryCount < 1 || !after.sha1) {
    throw new Error('storage smoke failed: file not cached/hashed');
  }

  // --- launch ---
  const argv = resolveArgs(['-f', '{romPath}'], { romPath: 'X', systemSlug: 's', emulatorDir: 'd' });
  if (argv.length !== 2 || argv[0] !== '-f' || argv[1] !== 'X') {
    throw new Error('launch smoke failed: token substitution');
  }

  const cmd = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe');
  const emu = createEmulator({ name: 'stub', exePath: cmd, defaultArgsTemplate: ['/c', 'exit'] });
  const gameRow = getDb().prepare('SELECT game_id FROM game_files LIMIT 1').get() as { game_id: number };
  const sysRow = getDb().prepare('SELECT system_id FROM games WHERE id = ?').get(gameRow.game_id) as {
    system_id: number;
  };
  setSystemEmulator(sysRow.system_id, emu.id, ['/c', 'exit']);

  const launched = await launch(gameRow.game_id);
  let ended = false;
  for (let i = 0; i < 50; i++) {
    const ps = getDb().prepare('SELECT ended_at FROM play_sessions WHERE id = ?').get(launched.sessionId) as {
      ended_at: number | null;
    };
    if (ps?.ended_at != null) {
      ended = true;
      break;
    }
    await sleep(100);
  }
  const playCount = (getDb().prepare('SELECT play_count FROM games WHERE id = ?').get(gameRow.game_id) as {
    play_count: number;
  }).play_count;
  console.log('[smoke] launch pid', launched.pid, 'ended', ended, 'playCount', playCount);
  if (!ended || playCount < 1) throw new Error('launch smoke failed: session not closed');
}

/** No-network checks for the IGDB catalog plumbing (real calls need credentials). */
export async function runCatalogSmoke(): Promise<void> {
  const tbl = getDb()
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='igdb_cache'")
    .get();
  if (!tbl) throw new Error('catalog smoke failed: igdb_cache table missing');

  const q = buildGamesQuery({ platformId: 8, limit: 49, offset: 0 });
  if (!q.includes('where platforms = (8)') || !q.includes('limit 49')) {
    throw new Error('catalog smoke failed: query builder');
  }

  const img = igdbImageUrl('abc123', 't_cover_big');
  if (img !== 'https://images.igdb.com/igdb/image/upload/t_cover_big/abc123.jpg') {
    throw new Error('catalog smoke failed: image url');
  }

  const t0 = Date.now();
  await acquireSlot();
  await acquireSlot();
  await acquireSlot();
  const elapsed = Date.now() - t0;
  if (elapsed < 480) throw new Error(`catalog smoke failed: rate limiter too fast (${elapsed}ms)`);

  const creds = hasCredentials();
  console.log(
    '[smoke] catalog: query+image ok, rateLimiter',
    `${elapsed}ms`,
    'creds',
    creds.hasClientId,
    creds.hasClientSecret,
  );

  // Live IGDB validation when credentials are configured (e.g. via .env).
  if (creds.hasClientId && creds.hasClientSecret) {
    const conn = await igdbProvider.testConnection();
    console.log('[smoke] igdb testConnection:', conn.ok, '-', conn.message);
    if (!conn.ok) throw new Error(`igdb live connection failed: ${conn.message}`);
    const platforms: [string, number][] = [
      ['PS1', 7],
      ['PSP', 38],
      ['PS3', 9],
      ['SNES', 19],
      ['PS2', 8],
    ];
    for (const [name, pid] of platforms) {
      const list = await igdbProvider.listByPlatform(pid, { page: 0 });
      const top = list.items.slice(0, 3).map((i) => i.name).join(' · ');
      console.log(`[smoke] catalog ${name}: ${list.items.length} items | top: ${top || '(none)'}`);
      if (list.items.length === 0) throw new Error(`igdb live list empty for ${name}`);
    }
    const searchHit = await igdbProvider.listByPlatform(38, { search: 'grand theft auto', page: 0 });
    console.log(
      '[smoke] catalog PSP search "grand theft auto":',
      searchHit.items.slice(0, 3).map((i) => i.name).join(' · ') || '(none)',
    );
  }
}

/** No-network checks for the metadata scraping subsystem. */
export async function runMetadataSmoke(): Promise<void> {
  const game = getDb().prepare('SELECT id FROM games LIMIT 1').get() as { id: number } | undefined;
  if (!game) throw new Error('metadata smoke: no game to test');

  // scrape job idempotency (uq_scrape_jobs_active)
  const j1 = enqueueScrapeJob(game.id, ['screenscraper', 'thegamesdb']);
  const j2 = enqueueScrapeJob(game.id, ['screenscraper', 'thegamesdb']);
  if (j1 !== j2) throw new Error('metadata smoke: scrape job not idempotent');

  // worker with no ScreenScraper/TheGamesDB creds -> failed (graceful)
  await processJob(j1, game.id);
  const job = getDb().prepare('SELECT state FROM scrape_jobs WHERE id = ?').get(j1) as { state: string };
  if (job.state !== 'failed') throw new Error(`metadata smoke: expected failed without creds, got ${job.state}`);

  // manual lock gating
  const meta = {
    title: 'x',
    description: 'D',
    releaseDate: null,
    genre: null,
    players: null,
    rating: null,
    regions: [],
  };
  setMetadataLocked(game.id, true);
  if (denormalizeOntoGame(game.id, meta)) throw new Error('metadata smoke: denormalize ignored lock');
  if (!denormalizeOntoGame(game.id, meta, true)) throw new Error('metadata smoke: forced denormalize failed');
  setMetadataLocked(game.id, false);

  // media dedupe (uq_media_assets_dedupe)
  const db = getDb();
  const insert = (cs: string): { changes: number } =>
    db
      .prepare(
        `INSERT INTO media_assets (game_id, type, local_path, checksum, downloaded_at)
         VALUES (?, 'box2d', 'games/x.jpg', ?, ?) ON CONFLICT(game_id, type, checksum) DO NOTHING`,
      )
      .run(game.id, cs, Date.now());
  insert('deadbeef');
  if (insert('deadbeef').changes !== 0) throw new Error('metadata smoke: media dedupe not enforced');

  console.log('[smoke] metadata: job idempotent, no-creds->failed, lock honored, media dedupe ok');
}

/** Exercises the save sync engine end-to-end against the LocalFolder provider. */
export async function runSavesSmoke(): Promise<void> {
  const game = getDb().prepare('SELECT id, system_id FROM games LIMIT 1').get() as
    | { id: number; system_id: number }
    | undefined;
  if (!game) throw new Error('saves smoke: no game to test');

  // Clean the remote save store so each run starts from a known baseline (the
  // remote persists on disk across runs while the in-memory DB does not).
  await rm(join(app.getPath('userData'), 'smoke', 'storage', '.saves'), { recursive: true, force: true });

  const base = join(app.getPath('userData'), 'smoke', 'saves');
  await mkdir(base, { recursive: true });
  const savePath = join(base, 'TestGame.srm');
  await writeFile(savePath, 'SAVE-V1');
  const h = await hashFile(savePath);
  const saveId = upsertSave({
    gameId: game.id,
    systemId: game.system_id,
    type: 'sram',
    slot: null,
    localPath: savePath,
    sizeBytes: 7,
    crc32: h.crc32,
    md5: h.md5,
    sha1: h.sha1,
  });

  const stateOf = (): string => getSaveRowsForGame(game.id).find((r) => r.id === saveId)?.sync_state ?? '?';

  await syncGame(game.id); // first sync -> upload -> synced
  if (stateOf() !== 'synced') throw new Error(`saves smoke: expected synced after upload, got ${stateOf()}`);

  await syncGame(game.id); // no-op -> stays synced
  if (stateOf() !== 'synced') throw new Error('saves smoke: no-op sync changed state');

  await writeFile(savePath, 'SAVE-V2-CHANGED'); // local change -> re-upload -> synced
  await syncGame(game.id);
  if (stateOf() !== 'synced') throw new Error('saves smoke: re-sync after local change failed');

  // SaveSyncProvider (extracted from StorageProvider) lists the uploaded save.
  const sys = getDb().prepare('SELECT slug FROM systems WHERE id=?').get(game.system_id) as { slug: string } | undefined;
  const remotes = await getSaveSyncProvider().listSaves({
    gameId: game.id,
    systemSlug: sys?.slug ?? '',
    primaryStorageKey: '',
  });
  if (remotes.length < 1) throw new Error('saves smoke: SaveSyncProvider did not list the uploaded save');

  // Delete removes the file + row (mirrors the saves:delete handler).
  await rm(savePath, { force: true });
  deleteSaveRow(saveId);
  if (getSaveRowsForGame(game.id).some((r) => r.id === saveId)) {
    throw new Error('saves smoke: delete did not remove the save row');
  }

  console.log('[smoke] saves: upload->synced, no-op stable, re-sync ok, provider list ok, delete ok');
}

/** Live-validates the Internet Archive PS2 provider: matching, ranged GET, free space. */
export async function runArchiveSmoke(): Promise<void> {
  if (normalizeTitle('Grand Theft Auto: San Andreas') !== normalizeTitle('Grand Theft Auto San Andreas.iso')) {
    throw new Error('archive smoke: normalization mismatch');
  }
  if (normalizeTitle('Beyond Good & Evil') !== 'beyond good and evil') {
    throw new Error('archive smoke: & normalization');
  }
  // False-positive guard: region/disc words inside a real title must NOT be
  // stripped (only parenthesized tags are). Otherwise distinct games collapse to
  // the same key and the wrong ISO becomes downloadable.
  if (normalizeTitle('NTSC Racer') !== 'ntsc racer') throw new Error('archive smoke: region word stripped mid-title');
  if (normalizeTitle('World Tour USA') !== 'world tour usa') {
    throw new Error('archive smoke: trailing region word stripped');
  }
  if (normalizeTitle('NTSC Racer') === normalizeTitle('Racer')) {
    throw new Error('archive smoke: NTSC collapsed two distinct titles');
  }
  // Parenthesized region/disc tags ARE still removed (so true variants match).
  if (normalizeTitle('Grand Theft Auto: San Andreas (USA).iso') !== 'grand theft auto san andreas') {
    throw new Error('archive smoke: parenthesized region tag not stripped');
  }

  // free-disk-space mechanism (DownloadManager uses statfs before downloads)
  try {
    const s = await statfs(app.getPath('userData'));
    console.log('[smoke] archive: free disk GB', ((Number(s.bavail) * Number(s.bsize)) / 1024 ** 3).toFixed(1));
  } catch {
    console.log('[smoke] archive: statfs unavailable (free-space check is non-blocking)');
  }

  // Per-console normalization: the profile's extensions are stripped; base rules
  // still handle region/disc/bracket tags. Proves the generalization (Phase 4).
  if (normalizeTitle('Super Mario World (USA).sfc', { extensions: ['sfc', 'smc'] }) !== 'super mario world') {
    throw new Error('archive smoke: per-console extension strip (sfc) failed');
  }
  if (normalizeTitle('Chrono Trigger (USA) [!].sfc', { extensions: ['sfc'] }) !== 'chrono trigger') {
    throw new Error('archive smoke: per-console region/bracket strip failed');
  }
  if (normalizeTitle('Super Metroid.nes', { extensions: ['nes'] }) !== 'super metroid') {
    throw new Error('archive smoke: per-console extension strip (nes) failed');
  }

  const provider = getArchiveProvider('playstation2_essentials');
  const files = await provider.list();
  if (files.length < 100) throw new Error(`archive smoke: too few files (${files.length})`);
  const hit = await provider.matchTitle('Grand Theft Auto: San Andreas');
  const bogus = await provider.matchTitle('Totally Not A Real Game 9999');
  console.log(
    '[smoke] archive:',
    files.length,
    'files | GTA:SA ->',
    hit?.filename,
    `(${hit ? (hit.sizeBytes / 1024 ** 3).toFixed(1) : '?'} GB, md5 ${!!hit?.md5})`,
    '| bogus ->',
    bogus,
  );
  if (!hit || !hit.md5 || hit.sizeBytes <= 0) throw new Error('archive smoke: GTA:SA match missing md5/size');
  if (bogus) throw new Error('archive smoke: false positive on bogus title');

  const res = await fetch(await provider.getDownloadUrl(hit.filename), { headers: { Range: 'bytes=0-1023' } });
  console.log('[smoke] archive ranged GET:', res.status, res.headers.get('content-range'));
  await res.arrayBuffer();
  if (res.status !== 206) throw new Error('archive smoke: ranged GET unsupported (no 206)');
}

/**
 * Phase 1: prove the full PS2 download→launch loop end-to-end on a real title
 * ("Shadow of the Colossus"). Exercises the ARCHIVE path that runStorageSmoke (which
 * covers the manager's completion+verify+launch via LocalFolder) does not: archive
 * match → owned registration → REAL ranged GET + pause/resume continuity on the
 * actual multi-GB ISO → owned-pin → launch with {romPath} proof. The literal 4GB
 * completion is bounded (canceled after a few hundred KB); the manager's
 * completion/verify mechanics are proven by runStorageSmoke, so here we simulate the
 * cached blob with a small placeholder to drive the catalog→owned→launch handoff.
 */
export async function runPhase1Smoke(): Promise<void> {
  const cacheDir = join(app.getPath('userData'), 'smoke', 'p1cache');
  await rm(cacheDir, { recursive: true, force: true });
  await mkdir(cacheDir, { recursive: true });
  setSetting('cache.dir', cacheDir);
  setSetting('cache.sizeLimitBytes', 64 * 1024 ** 3); // generous so the free-disk check passes

  // Step 2 - archive match exposes filename + size + md5. Try the suggested clean-match
  // titles in order (some may be ambiguous/absent in the live item) and use the first hit.
  const provider = getArchiveProvider('playstation2_essentials');
  const CANDIDATES = ['Shadow of the Colossus', 'Resident Evil 4', 'God of War', 'Grand Theft Auto: San Andreas'];
  let TITLE = '';
  let match: Awaited<ReturnType<typeof provider.matchTitle>> = null;
  for (const t of CANDIDATES) {
    const m = await provider.matchTitle(t);
    if (m && m.sizeBytes > 0) {
      TITLE = t;
      match = m;
      break;
    }
  }
  if (!match) throw new Error('phase1: none of the candidate PS2 titles matched the archive item');
  console.log(
    `[smoke] phase1 match: "${TITLE}" -> ${match.filename} (${(match.sizeBytes / 1024 ** 3).toFixed(1)} GB, md5 ${!!match.md5})`,
  );

  // Step 4 - register owned (the core of catalog:download).
  const ps2 = getDb().prepare("SELECT id FROM systems WHERE slug='ps2'").get() as { id: number } | undefined;
  if (!ps2) throw new Error('phase1: ps2 system missing');
  const { gameId, gameFileId } = upsertArchiveFile({
    systemId: ps2.id,
    title: TITLE,
    storageKey: match.filename,
    sizeBytes: match.sizeBytes,
    md5: match.md5,
    source: 'archive-org:playstation2_essentials',
  });
  const fr = getDb()
    .prepare('SELECT source, is_primary, cache_state FROM game_files WHERE id=?')
    .get(gameFileId) as { source: string; is_primary: number; cache_state: string };
  if (!fr.source.startsWith('archive-org') || fr.is_primary !== 1 || fr.cache_state !== 'remote') {
    throw new Error('phase1: registration row wrong');
  }
  console.log('[smoke] phase1 registered gameId', gameId, 'gameFileId', gameFileId, 'source', fr.source);

  // Step 3 - REAL ranged GET + live progress + pause/resume continuity on the ISO.
  const url = await provider.getDownloadUrl(match.filename);
  const { id } = downloadManager.enqueue(gameFileId, 50);
  const dlState = (): { bytes_received: number; state: string; resume_offset: number; etag: string | null } =>
    getDb()
      .prepare('SELECT bytes_received, state, resume_offset, etag FROM downloads WHERE id=?')
      .get(id) as { bytes_received: number; state: string; resume_offset: number; etag: string | null };
  const waitFor = async (pred: (d: ReturnType<typeof dlState>) => boolean, timeoutMs: number): Promise<void> => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (pred(dlState())) return;
      await sleep(150);
    }
  };

  await waitFor((d) => d.bytes_received >= 256 * 1024 || d.state !== 'downloading', 30000);
  if (dlState().bytes_received < 256 * 1024) throw new Error('phase1: download did not progress (real ranged GET)');

  // The .part path is wherever the manager routed it (owned games now land in the
  // per-console games folder under storage.root, not the hashed cache) - read it back.
  const partPath = (getDb().prepare('SELECT temp_path FROM downloads WHERE id = ?').get(id) as { temp_path: string })
    .temp_path;

  // The Downloads-manager join (downloads -> game_files -> games -> systems + cover).
  const items = listDownloadItems();
  const mine = items.find((it) => it.gameFileId === gameFileId);
  if (!mine || !mine.title || !mine.systemSlug || mine.gameId !== gameId) {
    throw new Error('phase1: downloads:listItems join is broken');
  }
  console.log('[smoke] phase1 downloads:listItems ok -', mine.title, '/', mine.systemSlug, '/', mine.state);

  downloadManager.pause(id);
  await waitFor((d) => d.state === 'paused', 8000);
  const pausedOffset = dlState().resume_offset;
  const partSize = (await fsStat(partPath)).size;
  console.log('[smoke] phase1 paused: resume_offset', pausedOffset, 'partSize', partSize, 'etag', !!dlState().etag);
  // resume_offset is the total bytes on disk across the parallel segments. It must be
  // > 0 (something downloaded) and ≤ the .part size (the segments are disjoint ranges
  // within the file, so their sum can never exceed the file's extent).
  if (pausedOffset <= 0) throw new Error('phase1: nothing downloaded before pause');
  if (pausedOffset > partSize) throw new Error('phase1: resume_offset exceeds .part size (not disk-accurate)');

  // Correctness: byte-match on-disk bytes against a direct ranged GET, proving the
  // active engine writes the right bytes at the right offset. aria2 (the primary engine,
  // forced in-order under smoke) fills the .part contiguously and keeps a .aria2 control
  // file; the built-in fallback fills segments at their own offsets and keeps a .parts
  // sidecar. Verify whichever is in play.
  const aria2Active = (await ensureAria2()) != null;
  if (aria2Active) {
    const ctrlExists = await fsStat(`${partPath}.aria2`)
      .then(() => true)
      .catch(() => false);
    if (!ctrlExists) throw new Error('phase1: aria2 control file (.aria2) missing after pause - not resumable');
    const len = Math.min(partSize, 64 * 1024);
    const ref = Buffer.from(await (await fetch(url, { headers: { Range: `bytes=0-${len - 1}` } })).arrayBuffer());
    const fhPart = await open(partPath, 'r');
    const got = Buffer.alloc(ref.length);
    await fhPart.read(got, 0, ref.length, 0);
    await fhPart.close();
    if (!got.equals(ref)) {
      let i = 0;
      while (i < ref.length && got[i] === ref[i]) i++;
      throw new Error(`phase1: aria2 write mismatch off=0 len=${ref.length} firstDiff=${i}`);
    }
    console.log('[smoke] phase1 aria2 .part byte-matches remote (', ref.length, 'bytes ) + .aria2 present');
  } else {
    const sidecar = JSON.parse(await readFile(`${partPath}.parts`, 'utf8')) as {
      total: number;
      segments: Record<string, number>;
    };
    let bestSeg = -1;
    let bestBytes = 0;
    for (const [k, v] of Object.entries(sidecar.segments)) if (v > bestBytes) ((bestBytes = v), (bestSeg = Number(k)));
    if (bestSeg < 0 || bestBytes <= 0) throw new Error('phase1: sidecar records no written segment bytes');
    const off = bestSeg * SEGMENT_SIZE;
    const len = Math.min(bestBytes, 64 * 1024);
    const ref = Buffer.from(await (await fetch(url, { headers: { Range: `bytes=${off}-${off + len - 1}` } })).arrayBuffer());
    const fhPart = await open(partPath, 'r');
    const got = Buffer.alloc(ref.length);
    await fhPart.read(got, 0, ref.length, off);
    await fhPart.close();
    if (!got.equals(ref)) {
      let i = 0;
      while (i < ref.length && got[i] === ref[i]) i++;
      throw new Error(
        `phase1: parallel write mismatch seg=${bestSeg} off=${off} len=${ref.length} firstDiff=${i} got=${got.subarray(i, i + 12).toString('hex')} ref=${ref.subarray(i, i + 12).toString('hex')}`,
      );
    }
    console.log('[smoke] phase1 segment', bestSeg, '@', off, 'byte-matches remote (', ref.length, 'bytes )');
  }

  // Resume must re-establish the connections and fetch NEW bytes past the pause point.
  // (Per-segment resume continues each segment from disk, so bytes_received climbs from
  // the paused total - it does not reset.)
  downloadManager.resume(id);
  await waitFor((d) => d.bytes_received >= pausedOffset + 256 * 1024 || d.state === 'completed' || d.state === 'failed', 30000);
  if (dlState().state === 'failed') throw new Error('phase1: resume failed');
  if (dlState().bytes_received <= pausedOffset) throw new Error('phase1: resume did not advance');
  console.log('[smoke] phase1 resumed, bytes_received', dlState().bytes_received);

  // Stop the multi-GB transfer - the loop is proven without downloading all of it.
  downloadManager.cancel(id);
  await waitFor((d) => d.state === 'canceled', 8000);

  try {
    const s = await statfs(cacheDir);
    console.log('[smoke] phase1 free disk GB', ((Number(s.bavail) * Number(s.bsize)) / 1024 ** 3).toFixed(1));
  } catch {
    /* non-blocking */
  }

  // Steps 4/5 - simulate the completed blob (bytes proven separately), pin it as
  // owned, and prove the catalog→owned→launch handoff: launch resolves {romPath} to
  // cache_entries.local_path and passes it to the (stub) emulator via the argv array.
  const finalPath = cache.cacheFilePath(match.filename);
  const placeholder = 'NOSTALGIA-PHASE1-PLACEHOLDER';
  await writeFile(finalPath, placeholder);
  cache.add({ gameFileId, cacheKey: match.filename, localPath: finalPath, sizeBytes: placeholder.length, verified: true });
  setCacheState(gameFileId, 'cached');
  cache.pin(gameFileId, true); // mirrors the manager's owned (source!='local') pin
  if (getEntryByFile(gameFileId)?.pinned !== 1) throw new Error('phase1: owned cache entry not pinned');

  const cmd = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe');
  const outCopy = join(cacheDir, 'rompath-proof.bin');
  await rm(outCopy, { force: true });
  const template = ['/c', 'copy', '/y', '{romPath}', outCopy]; // copies the rom path -> proof file
  const emu = createEmulator({ name: 'stub-pcsx2', exePath: cmd, defaultArgsTemplate: template });
  setSystemEmulator(ps2.id, emu.id, template);

  const launched = await launch(gameId, gameFileId);
  let ended = false;
  for (let i = 0; i < 60; i++) {
    const ps = getDb().prepare('SELECT ended_at FROM play_sessions WHERE id=?').get(launched.sessionId) as {
      ended_at: number | null;
    };
    if (ps?.ended_at != null) {
      ended = true;
      break;
    }
    await sleep(100);
  }
  let copied = '';
  try {
    copied = (await readFile(outCopy)).toString();
  } catch {
    /* outCopy missing -> romPath was not passed */
  }
  const playCount = (getDb().prepare('SELECT play_count FROM games WHERE id=?').get(gameId) as { play_count: number })
    .play_count;
  console.log(
    '[smoke] phase1 launch pid',
    launched.pid,
    'ended',
    ended,
    'playCount',
    playCount,
    'romPathPassed',
    copied.includes(placeholder),
  );
  if (!ended || playCount < 1) throw new Error('phase1: play session not opened/closed');
  if (!copied.includes(placeholder)) throw new Error('phase1: {romPath} (cache_entries.local_path) not passed to emulator');

  console.log('[smoke] phase1: match -> register -> 206 ranged -> pause/resume continuity -> pin -> launch {romPath} OK');
}

/**
 * Torrent engine (Phase 1 of the torrent-source work): prove the bundled aria2 daemon can
 * do BitTorrent end-to-end through our RPC wrappers - the capability Minerva Archive needs
 * - using a legal, well-seeded torrent (Blender's CC-BY "Sintel"). Exercises the full
 * chain: magnet -> metadata fetch -> bencode parse -> --select-file download of ONE small
 * member (poster.jpg, 46,115 B) WITHOUT pulling the 129 MB video. Network-dependent, so it
 * runs only under NOSTALGIA_SMOKE_TORRENT (kept out of the default smoke).
 */
export async function runTorrentSmoke(): Promise<void> {
  const dir = join(app.getPath('userData'), 'smoke', 'torrent');
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  if (!(await ensureAria2())) throw new Error('torrent smoke: aria2 daemon unavailable');

  const MAGNET =
    'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel' +
    '&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce' +
    '&tr=udp%3A%2F%2Fopen.demonii.com%3A1337%2Fannounce' +
    '&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A6969%2Fannounce';

  // 1) magnet -> .torrent metadata (proves swarm/DHT/tracker reachability).
  const meta = await fetchTorrentMetadata(MAGNET, dir);
  if (!meta) throw new Error('torrent smoke: metadata fetch returned null');
  const info = parseTorrent(meta);
  console.log('[smoke] torrent metadata:', info.name, '|', info.files.length, 'files');

  // 2) bencode parse -> pick the small file by name (poster.jpg), avoiding the big mp4.
  const poster = info.files.find((f) => f.path.endsWith('poster.jpg'));
  const video = info.files.find((f) => f.path.endsWith('.mp4'));
  if (!poster || !video) throw new Error('torrent smoke: expected Sintel poster.jpg + mp4 in file list');
  if (video.length < 50 * 1024 * 1024) throw new Error('torrent smoke: unexpected torrent (mp4 too small)');

  // 3) --select-file the small member only.
  let lastConns = 0;
  const res = await downloadTorrentViaAria2(meta, {
    dir,
    selectIndices: [poster.index],
    onProgress: (p) => (lastConns = Math.max(lastConns, p.connections)),
  });
  if (!res || res.outcome !== 'completed') throw new Error(`torrent smoke: download outcome ${res?.outcome}`);
  if (res.files.length !== 1) throw new Error(`torrent smoke: expected 1 selected file, got ${res.files.length}`);

  const posterSize = (await fsStat(res.files[0])).size;
  if (posterSize !== poster.length) {
    throw new Error(`torrent smoke: poster size ${posterSize} != expected ${poster.length}`);
  }
  // The whole point of --select-file: the 129 MB video must NOT have been downloaded.
  const videoPath = join(dir, info.name, video.path);
  const videoPulled = await fsStat(videoPath)
    .then((s) => s.size > 0)
    .catch(() => false);
  if (videoPulled) throw new Error('torrent smoke: unselected video was downloaded - select-file failed');

  console.log(
    `[smoke] torrent: select-file pulled ${info.name}/poster.jpg (${posterSize} B, peers ${lastConns}); 129MB video skipped OK`,
  );
}

/**
 * Folder-scan check: exercises the three outcomes a scan can produce against real files and
 * a real DB - ADOPT a game the user dropped in, RELINK one they renamed (size-matched), and
 * flag one they deleted as MISSING. The relink case is the reason this exists: a rename used
 * to orphan the row and prompt a re-download of a file sitting right there.
 */
export async function runFolderScanSmoke(): Promise<void> {
  const base = join(app.getPath('userData'), 'smoke-scan');
  await rm(base, { recursive: true, force: true });
  const storageRoot = join(base, 'games');
  setSetting('storage.root', storageRoot);

  const sys = getDb().prepare('SELECT id, slug FROM systems ORDER BY sort_order LIMIT 1').get() as {
    id: number;
    slug: string;
  };
  const dir = join(storageRoot, sys.slug);
  await mkdir(dir, { recursive: true });

  // Two distinct sizes so the size-based relink is unambiguous.
  await writeFile(join(dir, 'Dropped In Game.iso'), 'A'.repeat(4096));
  await writeFile(join(dir, 'Second Game.iso'), 'B'.repeat(8192));

  // (1) ADOPT - both files are new to the library.
  const first = await scanSystemFolder(sys.id);
  const adopted = getDb()
    .prepare(
      `SELECT gf.cache_state, ce.pinned, ce.local_path FROM game_files gf
         LEFT JOIN cache_entries ce ON ce.game_file_id = gf.id
        WHERE gf.storage_key = ?`,
    )
    .get('Dropped In Game.iso') as { cache_state: string; pinned: number; local_path: string } | undefined;
  console.log(
    '[smoke] folderScan adopt:',
    JSON.stringify(first),
    'state=' + String(adopted?.cache_state),
    'pinned=' + String(adopted?.pinned),
  );
  if (first.added !== 2 || adopted?.cache_state !== 'cached' || adopted.pinned !== 1) {
    throw new Error('folder scan: adopt did not produce two pinned, cached entries');
  }

  // (2) RELINK - rename one file; the row must follow it, not be orphaned.
  const { rename } = await import('node:fs/promises');
  await rename(join(dir, 'Dropped In Game.iso'), join(dir, 'Renamed By User.iso'));
  const second = await scanSystemFolder(sys.id);
  const relinked = getDb()
    .prepare('SELECT storage_key, cache_state FROM game_files WHERE storage_key = ?')
    .get('Renamed By User.iso') as { storage_key: string; cache_state: string } | undefined;
  console.log('[smoke] folderScan relink:', JSON.stringify(second), '->', JSON.stringify(relinked));
  if (second.relinked !== 1 || second.added !== 0 || relinked?.cache_state !== 'cached') {
    throw new Error('folder scan: rename should relink the existing row, not add a new game');
  }

  // (3) MISSING - delete a file; its row must become re-downloadable, not stay "cached".
  await rm(join(dir, 'Second Game.iso'), { force: true });
  const third = await scanSystemFolder(sys.id);
  const gone = getDb()
    .prepare('SELECT cache_state FROM game_files WHERE storage_key = ?')
    .get('Second Game.iso') as { cache_state: string } | undefined;
  console.log('[smoke] folderScan missing:', JSON.stringify(third), 'state=' + String(gone?.cache_state));
  // Assert on THIS row, not on the count: earlier smoke checks leave their own rows on the
  // same system, so an exact total would be testing the suite's history, not this scan.
  if (third.missing < 1 || gone?.cache_state !== 'remote') {
    throw new Error('folder scan: a deleted file should mark its row remote');
  }

  // (4) IDEMPOTENT - a re-run over an unchanged folder changes nothing.
  const fourth = await scanSystemFolder(sys.id);
  console.log('[smoke] folderScan rerun:', JSON.stringify(fourth));
  if (fourth.added !== 0 || fourth.relinked !== 0) throw new Error('folder scan: re-run was not idempotent');

  await rm(base, { recursive: true, force: true });
  console.log('[smoke] folderScan OK');
}

/**
 * Native Ports, offline: the bundled registry parses, migration 0009 applied, the release
 * asset glob picks the Windows build, unsafe tags/paths are refused, and auto-link hashes
 * an unhashed N64 file without linking it to a port it doesn't match. No network.
 */
export async function runRecompsSmoke(): Promise<void> {
  const { listManifests, recompExternalUrls } = await import('../recomps/registry');
  const { pickAsset, isSafeTag } = await import('../recomps/github');
  const { joinInside } = await import('../recomps/paths');
  const { autoLink } = await import('../recomps/linker');
  const { listDtos } = await import('../recomps/service');

  const manifests = listManifests();
  const ids = new Set(manifests.map((m) => m.id));
  if (manifests.length === 0 || ids.size !== manifests.length) throw new Error('recomps: registry empty or has duplicate ids');
  if (!recompExternalUrls().every((u) => u.startsWith('https://'))) throw new Error('recomps: non-https allow-list url');

  const db = getDb();
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='recomp_installs'").get()) {
    throw new Error('recomps: migration 0009 not applied');
  }
  const cols = db.prepare('PRAGMA table_info(play_sessions)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'recomp_id')) throw new Error('recomps: play_sessions.recomp_id missing');

  const zelda = [
    'Zelda64Recompiled-v1.2.2-Linux-ARM64.zip',
    'Zelda64Recompiled-v1.2.2-macOS.zip',
    'Zelda64Recompiled-v1.2.2-Windows.zip',
  ];
  const soh = ['SoH-Dewey-Bravo-Mac.zip', 'SoH-Dewey-Bravo-Win64.zip', 'SoH-Dewey-Bravo.appimage'];
  if (pickAsset(zelda, '*-Windows.zip') !== 'Zelda64Recompiled-v1.2.2-Windows.zip') throw new Error('recomps: glob (zelda)');
  if (pickAsset(soh, '*-Win64.zip') !== 'SoH-Dewey-Bravo-Win64.zip') throw new Error('recomps: glob (soh)');
  if (pickAsset(soh, '*-Windows.zip') !== null) throw new Error('recomps: glob matched nothing-should-match');
  if (pickAsset(['spaghetti-windows.zip'], 'spaghetti-windows.zip') !== 'spaghetti-windows.zip') {
    throw new Error('recomps: glob (literal)');
  }
  if (!isSafeTag('v1.2.2') || isSafeTag('..') || isSafeTag('a/b')) throw new Error('recomps: tag safety');
  let escaped = false;
  try {
    joinInside(join(app.getPath('userData'), 'x'), '../evil.exe');
  } catch {
    escaped = true;
  }
  if (!escaped) throw new Error('recomps: joinInside allowed an escaping path');

  // A hashless N64 file adopted from the games folder gets hashed by auto-link (in its
  // .z64 form too) but - not being an accepted dump - links to nothing.
  const base = join(app.getPath('userData'), 'smoke-recomps');
  await rm(base, { recursive: true, force: true });
  const storageRoot = join(base, 'games');
  setSetting('storage.root', storageRoot);
  const n64 = db.prepare("SELECT id FROM systems WHERE slug = 'n64'").get() as { id: number };
  await mkdir(join(storageRoot, 'n64'), { recursive: true });
  const rom = Buffer.alloc(4096);
  rom.writeUInt32BE(0x37804012, 0); // .v64 byte order
  await writeFile(join(storageRoot, 'n64', 'Not A Real Game.v64'), rom);
  await scanSystemFolder(n64.id);
  await autoLink();
  const row = db.prepare("SELECT sha1 FROM game_files WHERE storage_key = 'Not A Real Game.v64'").get() as
    | { sha1: string | null }
    | undefined;
  if (!row?.sha1) throw new Error('recomps: auto-link did not hash the unhashed N64 file');
  if (listDtos().some((d) => d.linkedGameId != null)) throw new Error('recomps: linked a port to a non-matching file');
  await rm(base, { recursive: true, force: true });
  console.log(`[smoke] recomps: ${manifests.length} ports parsed, migration ok, glob ok, auto-link ok`);
}

/**
 * Native Ports over the network (opt-in: NOSTALGIA_SMOKE_RECOMPS_NET=1). Installs Zelda 64:
 * Recompiled from its real GitHub release into a throwaway recomps.dir, checks it landed at
 * <recomps.dir>/zelda64recomp/<tag>/ with its exe, then uninstalls it.
 */
export async function runRecompsNetSmoke(): Promise<void> {
  const { startInstall, uninstall } = await import('../recomps/installer');
  const { getInstall } = await import('../db/repositories/recompsRepo');
  const dir = join(app.getPath('userData'), 'smoke-recomps-net');
  await rm(dir, { recursive: true, force: true });
  setSetting('recomps.dir', dir);

  startInstall('zelda64recomp');
  const deadline = Date.now() + 180_000;
  let row = getInstall('zelda64recomp');
  while (Date.now() < deadline) {
    row = getInstall('zelda64recomp');
    if (row?.state === 'installed' || row?.state === 'failed') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (row?.state !== 'installed') throw new Error(`recomps-net: install ended as ${row?.state}: ${row?.last_error}`);
  const expectedDir = join(dir, 'zelda64recomp', row.installed_tag!);
  if (row.install_dir !== expectedDir) throw new Error(`recomps-net: installed to ${row.install_dir}`);
  await fsStat(row.exe_path!);
  console.log(`[smoke] recomps-net: installed ${row.installed_tag} -> ${row.exe_path}`);

  await uninstall('zelda64recomp');
  const gone = await fsStat(expectedDir).then(
    () => false,
    () => true,
  );
  if (!gone || getInstall('zelda64recomp')?.state !== 'not_installed') throw new Error('recomps-net: uninstall left files');
  await rm(dir, { recursive: true, force: true });
  console.log('[smoke] recomps-net: uninstall ok');
}
