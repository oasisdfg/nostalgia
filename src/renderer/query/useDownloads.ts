import { useEffect } from 'react';
import { create } from 'zustand';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke, on } from '@renderer/bridge/ipc';
import { qk } from './keys';
import type { DownloadState } from '@shared/contracts/ipc';

export interface DownloadProgressInfo {
  id?: number;
  state?: DownloadState;
  error?: string | null;
  fraction: number | null;
  bytesReceived: number;
  bytesTotal: number | null;
  bytesPerSecond: number;
}

interface ProgressStore {
  byFile: Record<number, DownloadProgressInfo>;
  setProgress: (gameFileId: number, info: Partial<DownloadProgressInfo>) => void;
}

const DEFAULT_PROGRESS: DownloadProgressInfo = {
  fraction: null,
  bytesReceived: 0,
  bytesTotal: null,
  bytesPerSecond: 0,
};

export const useDownloadProgress = create<ProgressStore>((set) => ({
  byFile: {},
  setProgress: (gameFileId, info) =>
    set((s) => ({
      byFile: {
        ...s.byFile,
        [gameFileId]: { ...DEFAULT_PROGRESS, ...s.byFile[gameFileId], ...info },
      },
    })),
}));

/** Subscribes to download/cache push events and keeps the cache + queries live. Mount once. */
export function useDownloadEvents(): void {
  const qc = useQueryClient();
  const setProgress = useDownloadProgress((s) => s.setProgress);
  useEffect(() => {
    const offProgress = on('downloads:progress', (p) =>
      setProgress(p.gameFileId, {
        id: p.id,
        fraction: p.fraction,
        bytesReceived: p.bytesReceived,
        bytesTotal: p.bytesTotal,
        bytesPerSecond: p.bytesPerSecond,
      }),
    );
    const offState = on('downloads:stateChanged', (p) => {
      setProgress(p.gameFileId, { id: p.id, state: p.state, error: p.error ?? null });
      void qc.invalidateQueries({ queryKey: qk.gamesRoot });
      void qc.invalidateQueries({ queryKey: ['game'] });
      void qc.invalidateQueries({ queryKey: qk.downloadItems });
      // Catalog availability carries the owned gameId/gameFileId - refetch it so every
      // OTHER open surface (detail page, pop-out, Big Screen) re-attaches to a download
      // started elsewhere and shows the same live progress bar. The archive file index
      // is memoized in main, so this refetch is cheap.
      void qc.invalidateQueries({ queryKey: ['catalogAvail'] });
    });
    const offCache = on('cache:changed', () => void qc.invalidateQueries({ queryKey: qk.cacheStats }));
    return () => {
      offProgress();
      offState();
      offCache();
    };
  }, [qc, setProgress]);
}

/** All downloads with game/system context, for the Downloads manager view. */
export function useDownloadItems() {
  return useQuery({
    queryKey: qk.downloadItems,
    queryFn: () => invoke('downloads:listItems', undefined),
  });
}

export function useEnqueueDownload() {
  return useMutation({
    mutationFn: (vars: { gameFileId: number; priority?: number }) => invoke('downloads:enqueue', vars),
  });
}
export function usePauseDownload() {
  return useMutation({ mutationFn: (id: number) => invoke('downloads:pause', { id }) });
}
export function useResumeDownload() {
  return useMutation({ mutationFn: (id: number) => invoke('downloads:resume', { id }) });
}
export function useCancelDownload() {
  return useMutation({ mutationFn: (id: number) => invoke('downloads:cancel', { id }) });
}
