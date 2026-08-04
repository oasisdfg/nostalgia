import { Plus, X } from 'lucide-react';
import { Input } from '../Input';
import { Button } from '../Button';
import { IconButton } from '../IconButton';

const TOKENS = ['{romPath}', '{romDir}', '{romName}', '{systemSlug}', '{emulatorDir}'];

interface LaunchArgsEditorProps {
  value: string[];
  onChange: (value: string[]) => void;
}

/**
 * Edits a launch-argument template as a list of discrete argv elements (never a
 * concatenated string). Tokens are inserted as their own elements, e.g.
 * ["-f", "{romPath}"].
 */
export function LaunchArgsEditor({ value, onChange }: LaunchArgsEditorProps) {
  const setAt = (i: number, v: string): void => onChange(value.map((a, idx) => (idx === i ? v : a)));
  const removeAt = (i: number): void => onChange(value.filter((_, idx) => idx !== i));
  const add = (v = ''): void => onChange([...value, v]);

  return (
    <div className="space-y-2.5">
      <div className="space-y-1.5">
        {value.length === 0 && (
          <p className="text-2xs text-fg-faint">No arguments yet. The ROM path is passed via a token below.</p>
        )}
        {value.map((arg, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-5 text-right text-2xs tabular-nums text-fg-faint">{i + 1}</span>
            <Input value={arg} onChange={(e) => setAt(i, e.target.value)} className="flex-1 font-mono" />
            <IconButton icon={<X className="h-4 w-4" />} onClick={() => removeAt(i)} label="Remove argument" variant="danger" />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="secondary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => add('')}>
          Argument
        </Button>
        <span className="px-1 text-2xs text-fg-faint">Insert token</span>
        {TOKENS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => add(t)}
            className="rounded-md bg-surface-2 px-2 py-1 font-mono text-2xs text-accent transition-colors hover:bg-accent/10"
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}
