import { useEffect } from 'react';
import { useUiStore } from '@renderer/store/uiStore';
import { useSetFavorite } from '@renderer/query/useGames';

const isTyping = (el: EventTarget | null): boolean => {
  const node = el as HTMLElement | null;
  return !!node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable);
};

/**
 * Desktop keyboard shortcuts that aren't pure focus movement (norigin handles
 * arrows/enter): `/` focuses search, Esc closes the detail panel, `f` toggles
 * favorite on the focused game.
 */
export function useLibraryShortcuts(): void {
  const setSelectedGameId = useUiStore((s) => s.setSelectedGameId);
  const setFavorite = useSetFavorite();

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === '/' && !isTyping(e.target)) {
        e.preventDefault();
        document.getElementById('library-search')?.focus();
      } else if (e.key === 'Escape') {
        setSelectedGameId(null);
      } else if ((e.key === 'f' || e.key === 'F') && !isTyping(e.target)) {
        const focused = useUiStore.getState().focusedGame;
        if (focused) setFavorite.mutate({ id: focused.id, favorite: !focused.favorite });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSelectedGameId, setFavorite]);
}
