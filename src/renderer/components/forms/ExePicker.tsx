import { FolderOpen } from 'lucide-react';
import { useBrowseForExe } from '@renderer/query/useEmulators';
import { Button } from '../Button';
import { field } from '@renderer/theme/classes';

interface ExePickerProps {
  value: string;
  onChange: (exePath: string) => void;
}

/**
 * The only way to set an emulator exe path: read-only display + Browse button
 * wired to the OS file dialog. The path is never typed, pasted, or edited.
 */
export function ExePicker({ value, onChange }: ExePickerProps) {
  const browse = useBrowseForExe();
  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        value={value}
        placeholder="No executable selected"
        title={value}
        className={`${field} min-w-0 flex-1 truncate`}
      />
      <Button
        variant="secondary"
        icon={<FolderOpen className="h-4 w-4" />}
        disabled={browse.isPending}
        onClick={async () => {
          const result = await browse.mutateAsync();
          if (result) onChange(result.exePath);
        }}
      >
        Browse…
      </Button>
    </div>
  );
}
