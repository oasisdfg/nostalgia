import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@renderer/bridge/ipc';
import { qk } from './keys';

function invalidate(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: qk.cacheStats });
}

export function useEvictCache() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (targetBytes?: number) => invoke('cache:evict', { targetBytes }),
    onSuccess: () => invalidate(qc),
  });
}

export function useClearCache() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => invoke('cache:clear', undefined), onSuccess: () => invalidate(qc) });
}

export function usePinFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { gameFileId: number; pinned: boolean }) => invoke('cache:pin', vars),
    onSuccess: () => invalidate(qc),
  });
}
