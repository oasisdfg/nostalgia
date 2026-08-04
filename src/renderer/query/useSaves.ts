import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke, on } from '@renderer/bridge/ipc';

export function useSaves(gameId: number | null) {
  return useQuery({
    queryKey: ['saves', gameId],
    queryFn: () => invoke('saves:list', { gameId: gameId as number }),
    enabled: gameId != null,
  });
}

export function useSyncGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (gameId: number) => invoke('saves:syncGame', { gameId }),
    onSuccess: (_r, gameId) => void qc.invalidateQueries({ queryKey: ['saves', gameId] }),
  });
}

export function useSyncAllSaves() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => invoke('saves:syncAll', undefined),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['saves'] }),
  });
}

export function useResolveConflict() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { saveId: number; keep: 'local' | 'remote' }) => invoke('saves:resolveConflict', vars),
    onSuccess: (save) => void qc.invalidateQueries({ queryKey: ['saves', save.gameId] }),
  });
}

export function useRevealSave() {
  return useMutation({ mutationFn: (saveId: number) => invoke('saves:reveal', { saveId }) });
}

export function useDeleteSave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { saveId: number; gameId: number }) => invoke('saves:delete', { saveId: vars.saveId }),
    onSuccess: (_r, vars) => void qc.invalidateQueries({ queryKey: ['saves', vars.gameId] }),
  });
}

/** Refreshes the saves list as sync state changes. Mount once. */
export function useSavesEvents(): void {
  const qc = useQueryClient();
  useEffect(() => {
    return on('saves:syncStateChanged', (p) => void qc.invalidateQueries({ queryKey: ['saves', p.gameId] }));
  }, [qc]);
}
