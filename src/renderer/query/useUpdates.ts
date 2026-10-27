import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke, on } from '@renderer/bridge/ipc';
import { qk } from './keys';
import type { UpdateStatusDTO } from '@shared/contracts/ipc';

/** Nostalgia's own self-update state. Pushed live by useUpdateEvents - no polling. */
export function useUpdateStatus() {
  return useQuery({
    queryKey: qk.updateStatus,
    queryFn: () => invoke('updates:status', undefined),
    staleTime: Infinity,
  });
}

/** Writes 'updates:status' / 'updates:progress' straight into the query cache. Mount once per shell. */
export function useUpdateEvents(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const offStatus = on('updates:status', (s) => qc.setQueryData(qk.updateStatus, s));
    const offProgress = on('updates:progress', (p) =>
      qc.setQueryData<UpdateStatusDTO>(qk.updateStatus, (prev) =>
        prev ? { ...prev, state: 'downloading', fraction: p.fraction } : prev,
      ),
    );
    return () => {
      offStatus();
      offProgress();
    };
  }, [qc]);
}

export function useCheckForUpdates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => invoke('updates:check', undefined),
    onSuccess: (s) => qc.setQueryData(qk.updateStatus, s),
  });
}

export function useRestartToUpdate() {
  return useMutation({ mutationFn: () => invoke('updates:restart', undefined) });
}

export function useOpenReleasePage() {
  return useMutation({ mutationFn: () => invoke('updates:openReleasePage', undefined) });
}

/** What the update pill should offer, or null when there's nothing to act on. */
export type UpdatePillKind = 'downloading' | 'downloaded' | 'available';
export function updatePillKind(s: UpdateStatusDTO | undefined): UpdatePillKind | null {
  if (!s || s.mode === 'disabled') return null;
  if (s.mode === 'auto' && s.state === 'downloading') return 'downloading';
  if (s.mode === 'auto' && s.state === 'downloaded') return 'downloaded';
  if (s.mode === 'notify' && s.state === 'available') return 'available';
  return null;
}
