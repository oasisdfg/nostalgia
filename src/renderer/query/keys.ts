import type { LibraryQuery } from '@shared/contracts/ipc';

export const qk = {
  systems: ['systems'] as const,
  emulators: ['emulators'] as const,
  emulatorDir: ['emulators', 'dir'] as const,
  gamesRoot: ['games'] as const,
  games: (q: LibraryQuery) => ['games', q] as const,
  game: (id: number) => ['game', id] as const,
  settingsRoot: ['settings'] as const,
  setting: (key: string) => ['settings', key] as const,
  settingsMany: (keys: string[]) => ['settings', 'many', ...keys] as const,
  cacheStats: ['cache', 'stats'] as const,
  downloadItems: ['downloads', 'items'] as const,
  updateStatus: ['updates', 'status'] as const,
};
