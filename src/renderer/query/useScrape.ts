import { useEffect } from 'react';
import { create } from 'zustand';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke, on } from '@renderer/bridge/ipc';
import { qk } from './keys';
import type { ScrapeState } from '@shared/contracts/ipc';
import type { MetadataProviderId } from '@shared/contracts/metadata';

interface ScrapeStore {
  byGame: Record<number, ScrapeState>;
  setState: (gameId: number, state: ScrapeState) => void;
}
export const useScrapeStore = create<ScrapeStore>((set) => ({
  byGame: {},
  setState: (gameId, state) => set((s) => ({ byGame: { ...s.byGame, [gameId]: state } })),
}));

export function useEnqueueScrape() {
  return useMutation({ mutationFn: (gameId: number) => invoke('scrape:enqueue', { gameId }) });
}

export function useScrapeCandidates() {
  return useMutation({ mutationFn: (gameId: number) => invoke('scrape:candidates', { gameId }) });
}

export function useApplyManual() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { gameId: number; provider: MetadataProviderId; providerGameId: string }) =>
      invoke('scrape:applyManual', vars),
    onSuccess: (game) => {
      void qc.invalidateQueries({ queryKey: qk.gamesRoot });
      void qc.invalidateQueries({ queryKey: qk.game(game.id) });
    },
  });
}

/** Subscribes to scrape progress and refreshes the game when a scrape succeeds. Mount once. */
export function useScrapeEvents(): void {
  const qc = useQueryClient();
  const setState = useScrapeStore((s) => s.setState);
  useEffect(() => {
    return on('scrape:progress', (p) => {
      setState(p.gameId, p.state);
      if (p.state === 'succeeded') {
        void qc.invalidateQueries({ queryKey: qk.game(p.gameId) });
        void qc.invalidateQueries({ queryKey: qk.gamesRoot });
      }
    });
  }, [qc, setState]);
}
