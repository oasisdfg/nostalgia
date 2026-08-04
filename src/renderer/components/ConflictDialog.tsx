import { X } from 'lucide-react';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { useResolveConflict } from '@renderer/query/useSaves';
import type { SaveDTO } from '@shared/contracts/ipc';

export function ConflictDialog({ save, onClose }: { save: SaveDTO; onClose: () => void }) {
  const resolve = useResolveConflict();
  const pick = async (keep: 'local' | 'remote'): Promise<void> => {
    await resolve.mutateAsync({ saveId: save.id, keep });
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg bg-overlay shadow-e3 animate-pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pb-2 pt-3">
          <h3 className="text-sm font-semibold text-fg">Resolve save conflict</h3>
          <IconButton icon={<X className="h-4 w-4" />} onClick={onClose} label="Close" />
        </div>
        <div className="space-y-4 p-4">
          <p className="text-sm leading-relaxed text-fg-muted">
            This {save.type} changed both locally and remotely. Keep which version? The other copy is overwritten.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" fullWidth disabled={resolve.isPending} onClick={() => void pick('local')}>
              Keep local
            </Button>
            <Button variant="secondary" fullWidth disabled={resolve.isPending} onClick={() => void pick('remote')}>
              Keep remote
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
