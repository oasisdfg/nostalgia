import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { broadcastEvent } from '../ipc/registry';
import { resolveArgs } from '../launch/tokens';
import { ensureCached } from '../launch/launcher';
import * as playSessions from '../db/repositories/playSessionsRepo';
import { getInstall, openRecompSession, upsertInstall } from '../db/repositories/recompsRepo';
import { discoverSavesForGame } from '../saves/discovery';
import { getManifest } from './registry';
import { deliverFile, fileForPort } from './linker';
import { isInstallingPort } from './installer';
import { applyPortConfig } from './config';
import { buildWorkDir, findPython } from './builder';

/**
 * Starts an installed port for its linked game. Mirrors launcher.launch() minus the
 * emulator lookup: exe_path is main-resolved inside the install, argv is resolved
 * element-wise, and it is spawned without a shell.
 */
export async function launchRecomp(recompId: string): Promise<{ sessionId: number; pid: number }> {
  const manifest = getManifest(recompId);
  const row = getInstall(recompId);
  if (!manifest) throw new Error('Unknown port.');
  if (isInstallingPort(recompId)) throw new Error('Wait for the install to finish.');
  if (!row || row.state !== 'installed' || !row.exe_path || !row.install_dir) {
    throw new Error(`${manifest.name} isn't installed.`);
  }
  if (!existsSync(manifest.build ? row.install_dir : row.exe_path)) {
    throw new Error(`${manifest.name}'s files are missing. Reinstall it from Native Ports.`);
  }
  const gameId = row.linked_game_id;
  if (gameId == null) throw new Error(`Link your copy of ${manifest.originalTitle} first.`);
  const installDir = row.install_dir;

  await deliverFile(recompId);
  // The user's unified settings (fullscreen / resolution / frame cap) into the port's own
  // config. Best-effort: a config problem must never stop the game starting.
  await applyPortConfig(manifest, installDir).catch(() => undefined);
  const gameFileId = fileForPort(recompId, gameId);
  // Only fetch the file when the template actually passes it ({romPath} & co.).
  // A built port starts through its own python launcher script (build.run).
  const template = manifest.build ? manifest.build.run : manifest.args;
  const needsRom = template.some((a) => /\{rom(Path|Dir|Name)\}/.test(a));
  let romPath = '';
  if (needsRom) {
    if (gameFileId == null) throw new Error('The linked game has no file to give the port.');
    romPath = await ensureCached(gameFileId);
  }
  let exe = row.exe_path;
  let argv = resolveArgs(template, {
    romPath,
    systemSlug: manifest.gameFile.systemSlug,
    emulatorDir: installDir,
    installDir,
  }).map((a) => a.split('{workDir}').join(buildWorkDir(recompId)));
  if (manifest.build) {
    // Resolved by main from PATH at each launch (Python may have been updated or moved).
    const python = findPython();
    if (!python) throw new Error(`${manifest.name} needs Python 3 to start. ${manifest.build.requirements}`);
    exe = python.exe;
    argv = [...python.prefix, ...argv];
  }

  const child = spawn(exe, argv, { cwd: installDir, windowsHide: false, stdio: 'ignore' });
  try {
    await once(child, 'spawn');
  } catch {
    throw new Error(`Couldn't start ${manifest.name}.`);
  }

  const sessionId = openRecompSession({ gameId, gameFileId, recompId });
  // The port's own file picker has now been offered once ('in-app' delivery).
  if (manifest.gameFile.delivery === 'in-app' && !row.file_delivered) upsertInstall(recompId, { file_delivered: 1 });

  child.on('exit', (code) => {
    playSessions.close(sessionId, code);
    playSessions.rollupPlay(gameId);
    broadcastEvent('launch:exited', { sessionId, gameId, exitCode: code });
    void discoverSavesForGame(gameId);
  });
  child.on('error', (err) => {
    playSessions.close(sessionId, -1);
    broadcastEvent('launch:exited', { sessionId, gameId, exitCode: -1 });
    console.error('[recomps] port process error', err);
  });

  return { sessionId, pid: child.pid ?? -1 };
}
