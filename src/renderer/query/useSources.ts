import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@renderer/bridge/ipc';

const KEY = ['sources'] as const;

export function useCustomSources() {
  return useQuery({ queryKey: KEY, queryFn: () => invoke('sources:list', undefined) });
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>): void {
  void qc.invalidateQueries({ queryKey: KEY });
  // A new/removed source changes what titles are available to download.
  void qc.invalidateQueries({ queryKey: ['catalog'] });
  void qc.invalidateQueries({ queryKey: ['catalogAvail'] });
}

export function useAddSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { url: string; systemId: number }) => invoke('sources:add', vars),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useRemoveSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string }) => invoke('sources:remove', vars),
    onSuccess: () => invalidateAll(qc),
  });
}

const ARCHIVE_KEY = ['archiveStatus'] as const;

export function useArchiveStatus() {
  return useQuery({ queryKey: ARCHIVE_KEY, queryFn: () => invoke('sources:archiveStatus', undefined) });
}

/**
 * Saves archive.org S3 credentials. The access key is a plain setting; the secret goes
 * through the encrypted path (`encrypted: true`) and can never be read back out - same
 * treatment as the IGDB client secret.
 */
export function useSaveArchiveCredentials() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { key?: string; secret?: string }) => {
      if (vars.key) await invoke('settings:set', { key: 'archive.s3Key', value: vars.key, encrypted: false });
      if (vars.secret) await invoke('settings:set', { key: 'archive.s3Secret', value: vars.secret, encrypted: true });
      return { ok: true as const };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ARCHIVE_KEY });
      invalidateAll(qc); // credentials change which titles resolve as downloadable
    },
  });
}
