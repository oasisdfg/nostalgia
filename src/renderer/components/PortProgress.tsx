import { useRecompProgress, useRecompBuildStatus, busyLabel, busyFraction } from '@renderer/query/useRecomps';
import type { RecompDTO } from '@shared/contracts/recomps';

/**
 * A port's in-flight install/build: one status line and a bar. Builds show the build
 * script's current step (and its percentage when it prints one) - a status line, not a log.
 */
export function PortProgress({ port, size = 'sm', prefix }: { port: RecompDTO; size?: 'sm' | 'lg'; prefix?: string }) {
  const progress = useRecompProgress(port.manifest.id);
  const build = useRecompBuildStatus(port.manifest.id);
  const fraction = busyFraction(port, progress, build);
  const label = busyLabel(port, progress, build);
  return (
    <div className="min-w-0 flex-1">
      <p className={`truncate ${size === 'lg' ? 'text-base' : 'text-2xs'} text-fg-muted`} title={label}>
        {prefix ? `${prefix}: ` : ''}
        {label}
      </p>
      <div className={`mt-1.5 overflow-hidden rounded-full bg-bg/70 ${size === 'lg' ? 'h-2' : 'h-1.5'}`}>
        {fraction == null ? (
          <div className="h-full w-full animate-pulse rounded-full bg-accent/40" />
        ) : (
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.round(fraction * 100)}%` }} />
        )}
      </div>
    </div>
  );
}
