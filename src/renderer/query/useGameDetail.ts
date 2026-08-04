import { useQuery } from '@tanstack/react-query';
import { invoke } from '@renderer/bridge/ipc';
import { qk } from './keys';

export function useGameDetail(id: number | null) {
  return useQuery({
    queryKey: id == null ? (['game', 'none'] as const) : qk.game(id),
    queryFn: () => invoke('games:detail', { id: id as number }),
    enabled: id != null,
  });
}
