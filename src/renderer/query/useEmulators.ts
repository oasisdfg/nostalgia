import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@renderer/bridge/ipc';
import { qk } from './keys';
import type { CreateEmulatorInput, UpdateEmulatorPatch } from '@shared/contracts/ipc';

export function useEmulators() {
  return useQuery({ queryKey: qk.emulators, queryFn: () => invoke('emulators:list', undefined) });
}

export function useCreateEmulator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEmulatorInput) => invoke('emulators:create', input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.emulators }),
  });
}

export function useUpdateEmulator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: number; patch: UpdateEmulatorPatch }) => invoke('emulators:update', vars),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.emulators }),
  });
}

export function useDeleteEmulator() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => invoke('emulators:delete', { id }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.emulators }),
  });
}

/** Opens the OS file dialog to pick an emulator .exe; resolves to the path or null. */
export function useBrowseForExe() {
  return useMutation({ mutationFn: () => invoke('emulators:browseForExe', undefined) });
}

/** The app-managed emulator folder path. */
export function useEmulatorDir() {
  return useQuery({ queryKey: qk.emulatorDir, queryFn: () => invoke('emulators:getDir', undefined) });
}

/** Opens the managed emulator folder in the OS file explorer. */
export function useRevealEmulatorDir() {
  return useMutation({ mutationFn: () => invoke('emulators:revealDir', undefined) });
}

/** Scans the managed folder and registers any emulators found; refreshes the list. */
export function useScanEmulators() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => invoke('emulators:scanDir', undefined),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.emulators }),
  });
}
