import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@renderer/bridge/ipc';

export function useIgdbStatus() {
  return useQuery({ queryKey: ['igdbStatus'], queryFn: () => invoke('igdb:status', undefined) });
}

export function useTestIgdbConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => invoke('igdb:testConnection', undefined),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['igdbStatus'] }),
  });
}

export function useSaveIgdbCredentials() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { clientId?: string; clientSecret?: string }) => {
      if (vars.clientId !== undefined && vars.clientId.length > 0) {
        await invoke('settings:set', { key: 'igdb.clientId', value: vars.clientId, encrypted: false });
      }
      if (vars.clientSecret !== undefined && vars.clientSecret.length > 0) {
        await invoke('settings:set', { key: 'igdb.clientSecret', value: vars.clientSecret, encrypted: true });
      }
      return { ok: true as const };
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['igdbStatus'] }),
  });
}
