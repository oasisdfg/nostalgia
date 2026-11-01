import { useEffect } from 'react';
import { Focusable } from './Focusable';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';
import { useScrapeCandidates, useApplyManual } from '@renderer/query/useScrape';
import { Spinner } from './Spinner';
import type { MetadataProviderId } from '@shared/contracts/metadata';

export function ScrapeDialog({ gameId, onClose }: { gameId: number; onClose: () => void }) {
  const candidates = useScrapeCandidates();
  const apply = useApplyManual();

  useEffect(() => {
    candidates.mutate(gameId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  const onApply = async (provider: MetadataProviderId, providerGameId: string): Promise<void> => {
    await apply.mutateAsync({ gameId, provider, providerGameId });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg bg-overlay shadow-e3 animate-pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pb-2 pt-3">
          <h3 className="text-sm font-semibold text-fg">Choose a match</h3>
          <IconButton icon={<X className="h-4 w-4" />} onClick={onClose} label="Close" />
        </div>
        <div className="max-h-80 overflow-auto p-2">
          {candidates.isPending && <Spinner label="Searching…" />}
          {candidates.isError && <p className="p-3 text-sm text-danger">{(candidates.error as Error).message}</p>}
          {candidates.data && candidates.data.length === 0 && (
            <p className="p-3 text-sm text-fg-muted">No candidates found.</p>
          )}
          {candidates.data?.map((c) => (
            <Focusable
              key={`${c.provider}:${c.providerGameId}`}
              ariaLabel={c.title}
              focusable={!apply.isPending}
              focusClassName=""
              className="block rounded-md"
              onSelect={apply.isPending ? undefined : () => void onApply(c.provider, c.providerGameId)}
            >
              {(focused) => (
                <span
                  className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    focused ? 'bg-surface-2' : 'hover:bg-surface-2'
                  } ${apply.isPending ? 'opacity-50' : ''}`}
                >
                  <span className="truncate text-fg">{c.title}</span>
                  <span className="shrink-0 text-xs text-fg-muted">{c.provider}</span>
                </span>
              )}
            </Focusable>
          ))}
        </div>
      </div>
    </div>
  );
}
