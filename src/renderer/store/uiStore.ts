import { create } from 'zustand';
import type { LaunchPreflight, LibraryQuery } from '@shared/contracts/ipc';

/** A pending pre-launch setup reminder, raised by useGuardedLaunch and rendered once at
 *  app level (LaunchPromptHost) so every Play path is covered by a single dialog. */
export interface LaunchPrompt {
  gameId: number;
  gameFileId?: number;
  systemId?: number;
  preflight: LaunchPreflight;
}

export type UiMode = 'desktop' | 'bigscreen';
export type UiView = 'library' | 'downloads' | 'settings' | 'ports';
/** Sidebar console-list filter: 'library' shows only consoles you have games saved for;
 *  'browse' shows every console for catalog browsing. */
export type SidebarMode = 'library' | 'browse';

interface UiState {
  mode: UiMode;
  view: UiView;
  sidebarMode: SidebarMode;
  setSidebarMode: (mode: SidebarMode) => void;
  activeSystemId: number | null;
  selectedGameId: number | null;
  /** Deep-link target: a catalog detail (igdbId) CatalogView should auto-open on mount. */
  catalogDetailIgdbId: number | null;
  focusedGame: { id: number; favorite: boolean } | null;
  libraryQuery: LibraryQuery;
  sidebarCollapsed: boolean;
  /** When a game detail is open, its full-bleed artwork replaces the console backdrop app-wide. */
  detailBackdropUrl: string | null;
  setDetailBackdropUrl: (url: string | null) => void;
  launchPrompt: LaunchPrompt | null;
  setLaunchPrompt: (prompt: LaunchPrompt | null) => void;
  setMode: (mode: UiMode) => void;
  setView: (view: UiView) => void;
  setActiveSystemId: (id: number | null) => void;
  setSelectedGameId: (id: number | null) => void;
  clearCatalogDetail: () => void;
  /** Open a catalog title's detail inside its console view (Home → catalog deep-link). */
  openCatalogDetail: (systemId: number, igdbId: number) => void;
  /** Open an owned game's detail panel in the all-games library view (Home → owned game). */
  openOwnedGame: (gameId: number) => void;
  setFocusedGame: (game: { id: number; favorite: boolean } | null) => void;
  setLibraryQuery: (patch: Partial<LibraryQuery>) => void;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  mode: 'desktop',
  view: 'library', // Library is the landing view; console libraries are reachable from the sidebar.
  sidebarMode: 'library',
  setSidebarMode: (sidebarMode) => set({ sidebarMode }),
  activeSystemId: null,
  selectedGameId: null,
  catalogDetailIgdbId: null,
  focusedGame: null,
  libraryQuery: { sort: 'title', order: 'asc' },
  sidebarCollapsed: false,
  detailBackdropUrl: null,
  setDetailBackdropUrl: (detailBackdropUrl) => set({ detailBackdropUrl }),
  launchPrompt: null,
  setLaunchPrompt: (launchPrompt) => set({ launchPrompt }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setMode: (mode) => set({ mode }),
  setView: (view) => set({ view }),
  setActiveSystemId: (activeSystemId) =>
    set((s) => ({ activeSystemId, selectedGameId: null, libraryQuery: { ...s.libraryQuery, systemId: activeSystemId } })),
  setSelectedGameId: (selectedGameId) => set({ selectedGameId }),
  clearCatalogDetail: () => set({ catalogDetailIgdbId: null }),
  openCatalogDetail: (systemId, igdbId) =>
    set((s) => ({
      view: 'library',
      // A deep-link can target a console the filtered Library list hides - reveal it.
      sidebarMode: 'browse',
      activeSystemId: systemId,
      selectedGameId: null,
      catalogDetailIgdbId: igdbId,
      libraryQuery: { ...s.libraryQuery, systemId },
    })),
  openOwnedGame: (gameId) =>
    set((s) => ({
      view: 'library',
      activeSystemId: null,
      selectedGameId: gameId,
      libraryQuery: { ...s.libraryQuery, systemId: null },
    })),
  setFocusedGame: (focusedGame) => set({ focusedGame }),
  setLibraryQuery: (patch) => set((s) => ({ libraryQuery: { ...s.libraryQuery, ...patch } })),
}));
