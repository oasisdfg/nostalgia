import { useQuery } from '@tanstack/react-query';
import { invoke } from '@renderer/bridge/ipc';
import { qk } from './keys';

export function useCacheStats() {
  return useQuery({ queryKey: qk.cacheStats, queryFn: () => invoke('cache:stats', undefined) });
}
