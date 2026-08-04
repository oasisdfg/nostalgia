import { useState } from 'react';
import { RefreshCw, FolderOpen, Trash2 } from 'lucide-react';
import { Badge } from './Badge';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { ConflictDialog } from './ConflictDialog';
import { useSaves, useSyncGame, useRevealSave, useDeleteSave } from '@renderer/query/useSaves';
import type { SaveDTO, SaveType, SyncState } from '@shared/contracts/ipc';

const tone = (s: SyncState): 'positive' | 'danger' | 'warning' | 'neutral' =>
  s === 'synced' ? 'positive' : s === 'conflict' ? 'danger' : s === 'local_only' ? 'neutral' : 'warning';

const SAVE_LABEL: Record<SaveType, string> = {
  savestate: 'Save state',
  memorycard: 'Memory card',
  sram: 'Battery save',
  other: 'Save file',
};

function formatWhen(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

function formatBytes(n: number | null): string {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export function SavesPanel({ gameId }: { gameId: number }) {
  const { data: saves = [] } = useSaves(gameId);
  const sync = useSyncGame();
  const reveal = useRevealSave();
  const del = useDeleteSave();
  const [conflict, setConflict] = useState<SaveDTO | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-fg-muted">Saves</h3>
        <Button
          variant="ghost"
          size="sm"
          icon={<RefreshCw className={`h-3.5 w-3.5 ${sync.isPending ? 'animate-spin' : ''}`} />}
          onClick={() => sync.mutate(gameId)}
          disabled={sync.isPending}
        >
          Sync
        </Button>
      </div>
      <ul className="space-y-1.5 text-sm">
        {saves.length === 0 && <li className="text-fg-faint">No saves yet - play the game to capture them.</li>}
        {saves.map((sv) => (
          <li
            key={sv.id}
            className="flex items-center justify-between gap-2 rounded-md bg-bg/60 shadow-inset-1 px-2.5 py-1.5"
          >
            <div className="min-w-0">
              <p className="truncate text-fg">
                {SAVE_LABEL[sv.type]}
                {sv.slot != null ? ` · slot ${sv.slot}` : ''}
              </p>
              <p className="text-2xs text-fg-faint">
                {formatWhen(sv.updatedAt)}
                {sv.sizeBytes != null ? ` · ${formatBytes(sv.sizeBytes)}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {confirmId === sv.id ? (
                <>
                  <span className="text-2xs text-fg-muted">Delete?</span>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmId(null)}>
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={del.isPending}
                    onClick={() => {
                      del.mutate({ saveId: sv.id, gameId });
                      setConfirmId(null);
                    }}
                  >
                    Delete
                  </Button>
                </>
              ) : (
                <>
                  {sv.syncState === 'conflict' && (
                    <Button variant="danger" size="sm" onClick={() => setConflict(sv)}>
                      Resolve
                    </Button>
                  )}
                  <Badge tone={tone(sv.syncState)}>{sv.syncState.replace('_', ' ')}</Badge>
                  <IconButton
                    icon={<FolderOpen className="h-4 w-4" />}
                    label="Open save location"
                    onClick={() => reveal.mutate(sv.id)}
                  />
                  <IconButton
                    icon={<Trash2 className="h-4 w-4" />}
                    label="Delete save"
                    variant="danger"
                    onClick={() => setConfirmId(sv.id)}
                  />
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {conflict && <ConflictDialog save={conflict} onClose={() => setConflict(null)} />}
    </section>
  );
}
