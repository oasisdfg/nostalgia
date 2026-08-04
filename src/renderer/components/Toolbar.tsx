import { ArrowDownUp, ChevronDown } from 'lucide-react';
import { useUiStore } from '@renderer/store/uiStore';
import { SearchBar } from './SearchBar';
import type { LibraryQuery } from '@shared/contracts/ipc';

const SORTS: { value: NonNullable<LibraryQuery['sort']>; label: string }[] = [
  { value: 'title', label: 'Title' },
  { value: 'lastPlayed', label: 'Last played' },
  { value: 'addedAt', label: 'Date added' },
  { value: 'playCount', label: 'Most played' },
];

/**
 * Library header bar: search on the left; sort pinned to the right edge. The sort
 * control shares the search bar's recessed-well surface (bg-bg/70 + shadow-inset-1,
 * no borders) so the bar reads as one family. (No favorites filter — in the Library
 * every game is already a favorite; Library and favorites are the same set.)
 */
export function Toolbar() {
  const q = useUiStore((s) => s.libraryQuery);
  const setLibraryQuery = useUiStore((s) => s.setLibraryQuery);
  return (
    <div className="flex w-full items-center gap-2">
      <SearchBar value={q.search ?? ''} onChange={(search) => setLibraryQuery({ search })} />
      <div className="relative ml-auto">
        <ArrowDownUp className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint" />
        <select
          value={q.sort ?? 'title'}
          onChange={(e) => setLibraryQuery({ sort: e.target.value as LibraryQuery['sort'] })}
          aria-label="Sort"
          className="cursor-pointer appearance-none rounded-md bg-bg/70 shadow-inset-1 py-2 pl-9 pr-8 text-sm text-fg outline-none transition-colors hover:bg-bg focus:bg-bg focus:ring-1 focus:ring-accent/60"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint" />
      </div>
    </div>
  );
}
