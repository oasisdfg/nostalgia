import { Plus, X } from 'lucide-react';
import { Input } from '../Input';
import { Button } from '../Button';
import { IconButton } from '../IconButton';

// Each placeholder with the plain-language name the editor shows for it.
const TOKENS: { token: string; label: string }[] = [
  { token: '{romPath}', label: 'Game file' },
  { token: '{romDir}', label: 'Game folder' },
  { token: '{romName}', label: 'Game name' },
  { token: '{systemSlug}', label: 'Console' },
  { token: '{emulatorDir}', label: 'Emulator folder' },
];
const labelFor = (arg: string): string | undefined => TOKENS.find((t) => t.token === arg)?.label;

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
          <p className="text-xs text-fg-muted">No arguments yet. Add “Game file” below so the emulator opens the game.</p>
        )}
        {value.map((arg, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-5 text-right text-xs tabular-nums text-fg-muted">{i + 1}</span>
            <Input value={arg} onChange={(e) => setAt(i, e.target.value)} className="flex-1 font-mono" />
            {labelFor(arg) && <span className="shrink-0 text-xs text-fg-muted">{labelFor(arg)}</span>}
            <IconButton icon={<X className="h-4 w-4" />} onClick={() => removeAt(i)} label="Remove argument" variant="danger" />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="secondary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => add('')}>
          Argument
        </Button>
        <span className="px-1 text-xs text-fg-muted">Add</span>
        {TOKENS.map((t) => (
          <Button key={t.token} variant="secondary" size="sm" onClick={() => add(t.token)}>
            {t.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
