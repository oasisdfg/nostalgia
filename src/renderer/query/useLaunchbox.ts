import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke, on } from '@renderer/bridge/ipc';
import type { IpcEvent } from '@shared/contracts/ipc';

export function useLaunchboxStatus() {
  return useQuery({ queryKey: ['launchbox', 'status'], queryFn: () => invoke('launchbox:status', undefined) });
}

export function useLaunchboxImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => invoke('launchbox:import', undefined),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['launchbox', 'status'] });
      void qc.invalidateQueries({ queryKey: ['catalogGame'] }); // detail pages re-enrich
    },
  });
}

/** Subscribes to import progress and returns the latest event (null when idle/complete). */
export function useLaunchboxProgress(): IpcEvent<'launchbox:importProgress'> | null {
  const [progress, setProgress] = useState<IpcEvent<'launchbox:importProgress'> | null>(null);
  useEffect(() => {
    return on('launchbox:importProgress', (p) => setProgress(p.phase === 'done' ? null : p));
  }, []);
  return progress;
}
