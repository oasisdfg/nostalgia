import { ConsoleLogo } from './SystemIcon';

/** A section heading: console mark, name and count - spacing + label, never a line (UI-STYLE). */
export function SectionLabel({ slug, label, count }: { slug?: string; label: string; count: number }) {
  return (
    <div className="mb-1 flex items-center gap-2">
      {slug && <ConsoleLogo slug={slug} className="text-fg-muted" />}
      <h2 className="text-sm font-semibold text-fg">{label}</h2>
      <span className="text-xs tabular-nums text-fg-muted">{count}</span>
    </div>
  );
}
