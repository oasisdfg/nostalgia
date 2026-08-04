import { FolderOpen } from 'lucide-react';
import { Button } from '../Button';
import { useBrowseForFolder } from '@renderer/query/useSettings';

interface FolderPickerProps {
  value: string;
  onChange: (folderPath: string) => void;
  placeholder?: string;
}

/**
 * A folder field: shows the chosen path read-only and a Browse/Change action that
 * opens the native picker. The path is never typed - it is set verbatim from the
 * OS dialog. Selection calls onChange (callers persist immediately; no Save button).
 */
export function FolderPicker({ value, onChange, placeholder = 'No folder selected' }: FolderPickerProps) {
  const browse = useBrowseForFolder();
  const pick = async (): Promise<void> => {
    const result = await browse.mutateAsync();
    if (result) onChange(result.folderPath);
  };
  return (
    <div className="flex items-center gap-2">
      <span
        title={value || undefined}
        className={`min-w-0 flex-1 truncate rounded-md bg-bg/60 shadow-inset-1 px-3 py-2 text-sm ${
          value ? 'text-fg' : 'text-fg-faint'
        }`}
      >
        {value || placeholder}
      </span>
      <Button
        variant="secondary"
        icon={<FolderOpen className="h-4 w-4" />}
        onClick={() => void pick()}
        disabled={browse.isPending}
      >
        {value ? 'Change' : 'Browse…'}
      </Button>
    </div>
  );
}
