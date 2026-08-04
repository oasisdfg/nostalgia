import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@renderer/bridge/ipc';
import { qk } from './keys';
import type { CreateSystemInput, UpdateSystemPatch } from '@shared/contracts/ipc';

export function useSystems(enabledOnly = false) {
  return useQuery({
    queryKey: [...qk.systems, enabledOnly],
    queryFn: () => invoke('systems:list', { enabledOnly }),
  });
}

export function useCreateSystem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSystemInput) => invoke('systems:create', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.systems }),
  });
}

export function useUpdateSystem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: number; patch: UpdateSystemPatch }) => invoke('systems:update', vars),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.systems }),
  });
}

export function useDeleteSystem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => invoke('systems:delete', { id }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.systems }),
  });
}

export function useSetSystemEmulator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { systemId: number; emulatorId: number; launchArgsTemplate: string[] }) =>
      invoke('systems:setEmulator', vars),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.systems }),
  });
}
