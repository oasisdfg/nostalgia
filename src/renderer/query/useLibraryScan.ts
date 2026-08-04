import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@renderer/bridge/ipc';
import { qk } from './keys';

export function useLibraryScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { systemId: number; prefix?: string }) => invoke('library:scan', vars),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.gamesRoot }),
  });
}

/**
 * Reconciles a console's games folder with the library (adopt added files, re-link renamed
 * ones). Also invalidates the cache stats - adopting a file adds pinned bytes to the cache
 * accounting, and a missing one takes them away.
 */
export function useScanFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { systemId: number }) => invoke('library:scanFolder', vars),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.gamesRoot });
      void qc.invalidateQueries({ queryKey: qk.cacheStats });
    },
  });
}
