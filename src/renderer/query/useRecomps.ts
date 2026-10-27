import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke, on } from '@renderer/bridge/ipc';
import { useToasts } from '@renderer/components/Toast';
import { qk } from './keys';
import type { RecompDTO } from '@shared/contracts/recomps';

export interface RecompProgress {
  fraction: number;
  bytesReceived: number;
  bytesTotal: number | null;
}

/** Every port in the registry, with install/link state. */
export function useRecomps() {
  return useQuery({ queryKey: qk.recomps, queryFn: () => invoke('recomps:list', undefined) });
}

/** Ports linked to one game (drives the split Play button). */
export function useRecompsForGame(gameId: number | null) {
  return useQuery({
    queryKey: qk.recompsForGame(gameId ?? 0),
    queryFn: () => invoke('recomps:forGame', { gameId: gameId! }),
    enabled: gameId != null,
  });
}

/** Live install progress for one port (kept in the query cache, written by useRecompEvents). */
export function useRecompProgress(id: string) {
  return useQuery<RecompProgress | null>({
    queryKey: qk.recompProgress(id),
    queryFn: () => null,
    staleTime: Infinity,
    gcTime: Infinity,
  }).data;
}

/** Keeps port queries live from recomps:* push events. Mount once per shell. */
export function useRecompEvents(): void {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  useEffect(() => {
    const offProgress = on('recomps:progress', (p) =>
      qc.setQueryData<RecompProgress>(qk.recompProgress(p.id), {
        fraction: p.fraction,
        bytesReceived: p.bytesReceived,
        bytesTotal: p.bytesTotal,
      }),
    );
    const offState = on('recomps:stateChanged', (p) => {
      if (p.state !== 'downloading' && p.state !== 'verifying' && p.state !== 'extracting') {
        qc.setQueryData(qk.recompProgress(p.id), null);
      }
      if (p.error) push(p.error);
      void qc.invalidateQueries({ queryKey: qk.recomps });
    });
    // A port session ended: play counts and any discovered saves changed.
    const offExit = on('launch:exited', () => void qc.invalidateQueries({ queryKey: qk.recomps }));
    return () => {
      offProgress();
      offState();
      offExit();
    };
  }, [qc, push]);
}

/** Mutations share one shape: call a channel, refresh every port query, toast a failure. */
function usePortMutation<V>(fn: (vars: V) => Promise<unknown>) {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  return useMutation({
    mutationFn: fn,
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.recomps }),
    onError: (e) => push(e instanceof Error ? e.message : 'Something went wrong.'),
  });
}

export const useInstallRecomp = () => usePortMutation((id: string) => invoke('recomps:install', { id }));
export const useCancelRecomp = () => usePortMutation((id: string) => invoke('recomps:cancel', { id }));
export const useRollbackRecomp = () => usePortMutation((id: string) => invoke('recomps:rollback', { id }));
export const useUninstallRecomp = () => usePortMutation((id: string) => invoke('recomps:uninstall', { id }));
export const useLinkRecomp = () =>
  usePortMutation((v: { id: string; gameId: number }) => invoke('recomps:link', v));
export const useUnlinkRecomp = () => usePortMutation((id: string) => invoke('recomps:unlink', { id }));
export const useLaunchRecomp = () => usePortMutation((id: string) => invoke('recomps:launch', { id }));
export const useRevealRecompGameFile = () =>
  usePortMutation((id: string) => invoke('recomps:revealGameFile', { id }));
export const useRevealRecompInstall = () => usePortMutation((id: string) => invoke('recomps:revealInstall', { id }));
export const useCheckRecompUpdates = () =>
  usePortMutation((id?: string) => invoke('recomps:checkUpdates', id ? { id } : undefined));

/** In-flight install states (the button shows progress, not an action). */
export function isBusy(dto: RecompDTO): boolean {
  return dto.state === 'downloading' || dto.state === 'verifying' || dto.state === 'extracting';
}

export function busyLabel(dto: RecompDTO, p: RecompProgress | null | undefined): string {
  if (dto.state === 'verifying') return 'Verifying…';
  if (dto.state === 'extracting') return `Unpacking… ${p ? Math.round(p.fraction * 100) + '%' : ''}`;
  return `Downloading… ${p ? Math.round(p.fraction * 100) + '%' : ''}`;
}
