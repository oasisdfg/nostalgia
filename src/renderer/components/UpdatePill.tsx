import { useCallback } from 'react';
import { ArrowDownCircle, RefreshCw } from 'lucide-react';
import { Focusable } from './Focusable';
import { useToasts } from './Toast';
import {
  useUpdateStatus,
  useRestartToUpdate,
  useOpenReleasePage,
  updatePillKind,
  type UpdatePillKind,
} from '@renderer/query/useUpdates';
import aIcon from '../GamePadButtons/XGamepad/Default/T_X_A_Color.png';

/** The pill's state + its one action, shared by the Desktop sidebar and the Big Screen rail. */
export function useUpdatePill(): {
  kind: UpdatePillKind | null;
  label: string;
  percent: number;
  act: () => void;
} {
  const { data: status } = useUpdateStatus();
  const restart = useRestartToUpdate();
  const openPage = useOpenReleasePage();
  const push = useToasts((s) => s.push);
  const kind = updatePillKind(status);
  const percent = Math.round((status?.fraction ?? 0) * 100);

  const act = useCallback(() => {
    if (kind === 'downloaded') {
      restart.mutate(undefined, {
        onSuccess: (r) => {
          if (!r.ok) push(`${r.reason ?? "Can't restart right now."} It'll install when you close Nostalgia.`, 'info');
        },
      });
    } else if (kind === 'available') {
      openPage.mutate();
    }
  }, [kind, restart, openPage, push]);

  const label =
    kind === 'downloading'
      ? `Updating… ${percent}%`
      : kind === 'downloaded'
        ? 'Restart to update'
        : kind === 'available'
          ? `Version ${status?.version ?? ''} available`
          : '';
  return { kind, label, percent, act };
}

function ProgressLine({ percent }: { percent: number }) {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-surface-2">
      <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${percent}%` }} />
    </div>
  );
}

/**
 * Desktop sidebar pill - sits above Downloads and renders only when there's something to
 * act on (downloading, ready to restart, or a newer version for a portable build).
 * Collapsed sidebar: icon with a dot badge.
 */
export function SidebarUpdatePill({ collapsed }: { collapsed: boolean }) {
  const { kind, label, percent, act } = useUpdatePill();
  if (!kind) return null;
  const Icon = kind === 'downloaded' ? RefreshCw : ArrowDownCircle;
  const actionable = kind !== 'downloading';

  const body = (focused: boolean) => (
    <div
      title={collapsed ? label : undefined}
      className={`rounded-md px-1.5 py-1.5 text-sm transition-colors ${
        kind === 'downloaded'
          ? focused
            ? 'bg-accent/25 text-fg'
            : 'bg-accent/15 text-fg hover:bg-accent/25'
          : actionable && focused
            ? 'bg-white/10 text-fg'
            : actionable
              ? 'text-fg-muted hover:bg-white/5 hover:text-fg'
              : 'text-fg-muted'
      }`}
    >
      <div className={`flex items-center gap-2 ${collapsed ? 'justify-center' : ''}`}>
        <span className="relative flex h-6 w-11 shrink-0 items-center justify-center text-accent">
          <Icon className="h-4 w-4" />
          {collapsed && <span className="absolute right-2.5 top-0.5 h-1.5 w-1.5 rounded-full bg-accent" />}
        </span>
        {!collapsed && <span className="truncate font-medium">{label}</span>}
      </div>
      {kind === 'downloading' && !collapsed && (
        <div className="mt-1.5 px-1.5">
          <ProgressLine percent={percent} />
        </div>
      )}
    </div>
  );

  if (!actionable) return <div className="mb-0.5">{body(false)}</div>;
  return (
    <Focusable ariaLabel={label} focusClassName="" className="mb-0.5 block rounded-md" onSelect={act}>
      {(focused) => body(focused)}
    </Focusable>
  );
}

/** Big Screen rail item - last in the rail, same actions, A-button hint when focused. */
export function RailUpdatePill() {
  const { kind, label, percent, act } = useUpdatePill();
  if (!kind) return null;
  const Icon = kind === 'downloaded' ? RefreshCw : ArrowDownCircle;
  const actionable = kind !== 'downloading';

  const body = (focused: boolean) => (
    <div
      className={`flex flex-col items-center gap-1.5 rounded-lg px-1 py-3 text-center transition-colors ${
        kind === 'downloaded' ? (focused ? 'bg-accent/25' : 'bg-accent/15') : focused ? 'bg-surface-2' : ''
      }`}
    >
      <Icon className="h-6 w-6 text-accent" />
      <span className="text-2xs font-medium leading-tight text-fg">{label}</span>
      {kind === 'downloading' && (
        <div className="w-full px-2">
          <ProgressLine percent={percent} />
        </div>
      )}
      {focused && actionable && (
        <img src={aIcon} alt="" aria-hidden draggable={false} className="h-6 w-6 object-contain" />
      )}
    </div>
  );

  if (!actionable) return <div className="mt-auto">{body(false)}</div>;
  return (
    <Focusable focusKey="bs-rail-update" ariaLabel={label} focusClassName="" className="mt-auto rounded-lg" onSelect={act}>
      {(focused) => body(focused)}
    </Focusable>
  );
}
