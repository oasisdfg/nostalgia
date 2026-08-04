import { Search } from 'lucide-react';

export function SearchBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative w-72 max-w-full">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
      <input
        id="library-search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search…"
        className="w-full rounded-md bg-bg/70 shadow-inset-1 py-2 pl-9 pr-3 text-sm text-fg outline-none transition-colors placeholder:text-fg-faint focus:bg-bg focus:ring-1 focus:ring-accent/60"
      />
    </div>
  );
}
