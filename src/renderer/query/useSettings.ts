import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@renderer/bridge/ipc';
import { qk } from './keys';

export function useSetting(key: string) {
  return useQuery({ queryKey: qk.setting(key), queryFn: () => invoke('settings:get', { key }) });
}

export function useSettingsMany(keys: string[]) {
  return useQuery({ queryKey: qk.settingsMany(keys), queryFn: () => invoke('settings:getMany', { keys }) });
}

export function useSetSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { key: string; value: unknown; encrypted?: boolean }) => invoke('settings:set', vars),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: qk.settingsRoot });
      // `cache:stats` reports limitBytes/dir straight from these settings, so a saved
      // cache.* value must refresh it too - otherwise the usage bar keeps showing the old
      // limit until the view is unmounted and remounted.
      if (vars.key.startsWith('cache.')) void qc.invalidateQueries({ queryKey: qk.cacheStats });
    },
  });
}

/** Opens the native folder picker. Returns the chosen absolute path, or null on cancel. */
export function useBrowseForFolder() {
  return useMutation({ mutationFn: () => invoke('storage:browseForFolder', undefined) });
}
