import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke, on } from '@renderer/bridge/ipc';
import { qk } from './keys';
import { useUiStore } from '@renderer/store/uiStore';

export function useLaunch() {
  return useMutation({
    mutationFn: (vars: { gameId: number; gameFileId?: number }) => invoke('launch:start', vars),
  });
}

interface LaunchVars {
  gameId: number;
  gameFileId?: number;
}

export interface GuardedLaunch {
  /** Runs the readiness check, then either launches or raises the setup dialog. */
  start: (vars: LaunchVars & { systemId?: number }) => void;
  isPending: boolean;
  isError: boolean;
  error: unknown;
}

/**
 * Play, gated by the advisory pre-launch readiness check (see `launch:preflight`).
 *
 * When a title needs setup the prompt is raised into the ui store and rendered once by
 * <LaunchPromptHost/> at app level, so every Play path in the app is covered without each
 * call site wiring up its own dialog.
 *
 * The check is best-effort on the main side and returns `needsSetup: false` for anything
 * that is fine or unknown, so a failure here can never stop a launch - a rejected preflight
 * falls straight through to launching.
 */
export function useGuardedLaunch(): GuardedLaunch {
  const launch = useLaunch();
  const setLaunchPrompt = useUiStore((s) => s.setLaunchPrompt);
  const [checking, setChecking] = useState(false);

  const start = useCallback(
    ({ systemId, ...vars }: LaunchVars & { systemId?: number }) => {
      setChecking(true);
      void invoke('launch:preflight', vars)
        .then((preflight) => {
          if (preflight.needsSetup) setLaunchPrompt({ ...vars, systemId, preflight });
          else launch.mutate(vars);
        })
        .catch(() => launch.mutate(vars)) // advisory only - never block Play
        .finally(() => setChecking(false));
    },
    [launch, setLaunchPrompt],
  );

  return {
    start,
    isPending: checking || launch.isPending,
    isError: launch.isError,
    error: launch.error,
  };
}

/** "Don't remind me again" for a game's pre-launch setup check. */
export function useDismissReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { gameId: number }) => invoke('launch:dismissReminder', vars),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.gamesRoot });
      void qc.invalidateQueries({ queryKey: ['game'] });
    },
  });
}

/** Opens a console's emulator with no game loaded (BIOS / controller / save-state setup). */
export function useLaunchEmulator() {
  return useMutation({
    mutationFn: (vars: { systemId: number }) => invoke('launch:emulator', vars),
  });
}

/** Refreshes play stats when a launched game exits. Mount once. */
export function useLaunchEvents(): void {
  const qc = useQueryClient();
  useEffect(() => {
    return on('launch:exited', () => {
      void qc.invalidateQueries({ queryKey: qk.gamesRoot });
      void qc.invalidateQueries({ queryKey: ['game'] });
    });
  }, [qc]);
}
