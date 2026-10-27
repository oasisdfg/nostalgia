import type { RecompDTO, RecompManifest } from '@shared/contracts/recomps';
import { getInstall, listInstalls, listInstallsForGame, type RecompInstallRow } from '../db/repositories/recompsRepo';
import { listManifests, getManifest } from './registry';
import { isFileVerified } from './linker';

/** Builds the renderer view of a port. No paths, URLs or ids beyond games.id cross IPC. */
export function toDto(manifest: RecompManifest, row: RecompInstallRow | undefined): RecompDTO {
  const installed = row?.installed_tag ?? null;
  const latest = row?.latest_tag ?? null;
  return {
    manifest,
    state: row?.state ?? 'not_installed',
    installedTag: installed,
    previousTag: row?.previous_tag ?? null,
    latestTag: latest,
    updateAvailable: row?.state === 'installed' && installed != null && latest != null && latest !== installed,
    linkedGameId: row?.linked_game_id ?? null,
    fileVerified: row?.linked_game_id != null && isFileVerified(manifest.id),
    fileDelivered: (row?.file_delivered ?? 0) === 1,
    lastError: row?.last_error ?? null,
  };
}

export function listDtos(): RecompDTO[] {
  const rows = new Map(listInstalls().map((r) => [r.recomp_id, r]));
  return listManifests().map((m) => toDto(m, rows.get(m.id)));
}

export function dtoFor(id: string): RecompDTO {
  const manifest = getManifest(id);
  if (!manifest) throw new Error('Unknown port.');
  return toDto(manifest, getInstall(id));
}

/** Ports linked to a game, in registry order. */
export function dtosForGame(gameId: number): RecompDTO[] {
  const rows = new Map(listInstallsForGame(gameId).map((r) => [r.recomp_id, r]));
  return listManifests()
    .filter((m) => rows.has(m.id))
    .map((m) => toDto(m, rows.get(m.id)));
}
