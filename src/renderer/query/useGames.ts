import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@renderer/bridge/ipc';
import { qk } from './keys';
import type { LibraryQuery, UpdateGamePatch } from '@shared/contracts/ipc';

/**
 * Kicks off the one-shot LaunchBox box-front cover upgrade in main (idempotent - it
 * skips games already upgraded) and refreshes the library grids if anything changed.
 * Mount once (DesktopShell).
 */
export function useBoxartUpgrade(): void {
  const qc = useQueryClient();
  useEffect(() => {
    let alive = true;
    invoke('library:upgradeBoxart', undefined)
      .then((r) => {
        if (alive && r.upgraded > 0) void qc.invalidateQueries({ queryKey: qk.gamesRoot });
      })
      .catch(() => undefined); // cosmetic pass - never surface an error for it
    return () => {
      alive = false;
    };
  }, [qc]);
}

export function useGames(query: LibraryQuery) {
  return useQuery({ queryKey: qk.games(query), queryFn: () => invoke('games:list', query) });
}

export function useSetFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: number; favorite: boolean }) => invoke('games:setFavorite', vars),
    // game is null when un-favoriting deleted a file-less catalog favorite row.
    onSuccess: (game, vars) => {
      void qc.invalidateQueries({ queryKey: qk.gamesRoot });
      void qc.invalidateQueries({ queryKey: qk.game(game?.id ?? vars.id) });
      // Favorites / My List / Library are ONE shared state (games.favorite). Refresh the
      // catalog hearts too so the same title reads consistently everywhere it's shown.
      void qc.invalidateQueries({ queryKey: ['catalog'] });
      void qc.invalidateQueries({ queryKey: ['catalogAvail'] });
      void qc.invalidateQueries({ queryKey: ['catalogGame'] });
    },
  });
}

export function useUpdateGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: number; patch: UpdateGamePatch }) => invoke('games:update', vars),
    onSuccess: (game) => {
      void qc.invalidateQueries({ queryKey: qk.gamesRoot });
      void qc.invalidateQueries({ queryKey: qk.game(game.id) });
    },
  });
}

export function useRemoveGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { gameId: number }) => invoke('library:remove', vars),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.gamesRoot });
    },
  });
}

/** Uninstall: delete downloaded files but keep the library entry (re-installable). */
export function useUninstallGame() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { gameId: number }) => invoke('library:uninstall', vars),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.gamesRoot });
      void qc.invalidateQueries({ queryKey: qk.cacheStats });
    },
  });
}
