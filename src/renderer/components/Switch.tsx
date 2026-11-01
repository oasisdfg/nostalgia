import { Focusable } from './Focusable';

/**
 * An on/off switch for a single boolean setting. Spatial-focusable (A / Enter toggles);
 * the label sits beside it, so the whole row is the hit area.
 */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <Focusable ariaLabel={label} ariaPressed={checked} className="inline-flex rounded-md" onSelect={() => onChange(!checked)}>
      <span className="flex cursor-pointer items-center gap-3 py-1">
        <span
          aria-hidden
          className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-bg/70 shadow-inset-1'}`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-fg shadow-e1 transition-[left] motion-reduce:transition-none ${
              checked ? 'left-[1.125rem]' : 'left-0.5'
            }`}
          />
        </span>
        <span className="text-sm text-fg">{label}</span>
      </span>
    </Focusable>
  );
}
