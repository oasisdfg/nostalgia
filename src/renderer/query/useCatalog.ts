import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { invoke } from '@renderer/bridge/ipc';
import type { CatalogSort } from '@shared/contracts/catalog';
import { qk } from './keys';
import { useDownloadProgress, usePauseDownload, useResumeDownload, useCancelDownload } from './useDownloads';
import { useGuardedLaunch } from './useLaunch';

export function useCatalogList(systemId: number, search: string, page: number, sort: CatalogSort, filter: string) {
  return useQuery({
    queryKey: ['catalog', systemId, search, page, sort, filter],
    queryFn: () =>
      invoke('catalog:listByPlatform', {
        systemId,
        search: search || undefined,
        page,
        sort,
        filter: filter || undefined,
      }),
    placeholderData: keepPreviousData,
  });
}

export function useCatalogGameDetails(igdbId: number | null, systemId?: number) {
  return useQuery({
    queryKey: ['catalogGame', igdbId, systemId],
    queryFn: () => invoke('catalog:gameDetails', { igdbId: igdbId as number, systemId }),
    enabled: igdbId != null,
  });
}

export function useCatalogAvailability(igdbId: number | null, systemId: number) {
  return useQuery({
    queryKey: ['catalogAvail', systemId, igdbId],
    queryFn: () => invoke('catalog:availability', { igdbId: igdbId as number, systemId }),
    enabled: igdbId != null,
  });
}

export function useCatalogDownload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { igdbId: number; systemId: number }) => invoke('catalog:download', vars),
    // The title now owns a file - refresh the library grid so it reads as installed.
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.gamesRoot }),
  });
}

/** Toggle a CATALOG title in My List. Invalidates catalog lists, availability, and games. */
export function useCatalogSetFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { igdbId: number; systemId: number; favorite: boolean }) =>
      invoke('catalog:setFavorite', vars),
    onSuccess: () => {
      // Same shared favorite state - invalidate every surface that shows a heart/star.
      void qc.invalidateQueries({ queryKey: ['catalog'] });
      void qc.invalidateQueries({ queryKey: ['catalogAvail'] });
      void qc.invalidateQueries({ queryKey: ['catalogGame'] });
      void qc.invalidateQueries({ queryKey: qk.gamesRoot });
    },
  });
}

export function formatSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  const gb = bytes / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

export interface AcquisitionStatus {
  tone: 'muted' | 'accent' | 'danger' | 'positive';
  text: string;
}

/**
 * The catalog acquisition + launch lifecycle for one title, shared by the Desktop
 * and Big Screen detail pages so both drive the SAME Phase 1 chain (availability →
 * download → progress → launch) with identical states - not a fork.
 */
export function useCatalogAcquisition(igdbId: number | null, systemId: number) {
  const avail = useCatalogAvailability(igdbId, systemId);
  const download = useCatalogDownload();
  const launch = useGuardedLaunch();
  const pause = usePauseDownload();
  const resume = useResumeDownload();
  const cancel = useCancelDownload();
  const [fileId, setFileId] = useState<number | null>(null);
  const [gameId, setGameId] = useState<number | null>(null);

  // Re-attach: if this title was already acquired, availability returns its owned ids.
  // Seed them so re-opening the page picks up the in-flight download (the manager runs
  // in main and never stopped) instead of offering a fresh one.
  useEffect(() => {
    if (avail.data?.gameFileId != null) setFileId((cur) => cur ?? avail.data!.gameFileId!);
    if (avail.data?.gameId != null) setGameId((cur) => cur ?? avail.data!.gameId!);
  }, [avail.data?.gameFileId, avail.data?.gameId]);

  const dl = useDownloadProgress((s) => (fileId != null ? s.byFile[fileId] : undefined));
  const dlState = dl?.state;
  // A file cached in a PREVIOUS session has no entry in this session's progress store,
  // so also trust availability's cached flag when no live download state exists -
  // otherwise a re-opened app shows Download for a game that's ready to play.
  const downloaded = dlState === 'completed' || (dlState == null && (avail.data?.cached ?? false));
  const paused = dlState === 'paused';
  const downloadFailed = dlState === 'failed' || dlState === 'canceled';
  const downloading = fileId != null && (dlState === 'queued' || dlState === 'downloading' || dlState === 'verifying');
  const downloadId = dl?.id;
  const available = avail.data?.available ?? false;

  const startDownload = async (): Promise<void> => {
    if (igdbId == null) return;
    const res = await download.mutateAsync({ igdbId, systemId });
    setGameId(res.gameId);
    setFileId(res.gameFileId);
  };
  const play = (): void => {
    if (gameId != null) launch.start({ gameId, gameFileId: fileId ?? undefined, systemId });
  };

  let status: AcquisitionStatus;
  if (download.isPending) status = { tone: 'muted', text: 'Starting download…' };
  else if (downloadFailed) status = { tone: 'danger', text: dl?.error ?? 'Download failed.' };
  else if (dlState === 'verifying') status = { tone: 'muted', text: 'Verifying…' };
  else if (paused) status = { tone: 'muted', text: 'Paused' };
  else if (downloading) status = { tone: 'muted', text: dlState === 'queued' ? 'Queued…' : 'Downloading…' };
  // Downloaded and still-checking states are conveyed by the action button itself
  // (Play / a "Checking" label) - no status line.
  else if (downloaded) status = { tone: 'positive', text: '' };
  else if (avail.isLoading) status = { tone: 'muted', text: '' };
  else if (avail.isError) status = { tone: 'danger', text: 'Couldn’t check availability.' };
  // Ready-to-download is conveyed by the enabled Download button alone - the old
  // "Ready to download · <file> · <size>" line was noise (and leaked filenames).
  else if (available) status = { tone: 'accent', text: '' };
  else status = { tone: 'muted', text: 'Not available to download yet.' };

  // Launch progress/success shows on the Play button; only launch FAILURES need a line.
  if (launch.isError)
    status = { tone: 'danger', text: launch.error instanceof Error ? launch.error.message : 'Could not launch.' };

  return {
    avail,
    available,
    fileId,
    gameId,
    downloaded,
    paused,
    downloadFailed,
    downloading,
    downloadId,
    status,
    download,
    launch,
    pause,
    resume,
    cancel,
    startDownload,
    play,
  };
}
