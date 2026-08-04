import { type ReactNode } from 'react';
import { panel } from '@renderer/theme/classes';

const PAD = { sm: 'p-4', md: 'p-5' } as const;

/**
 * A surface card. Optionally renders a header (sentence-case title + description +
 * trailing actions). Body children manage their own vertical rhythm (e.g. wrap in
 * `space-y-4`). The single source of the panel look so every grouped section matches.
 */
export function Card({
  title,
  description,
  actions,
  padding = 'md',
  children,
  className = '',
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  padding?: keyof typeof PAD;
  children?: ReactNode;
  className?: string;
}) {
  const hasHeader = title != null || actions != null;
  return (
    <section className={`${panel} ${PAD[padding]} ${className}`}>
      {hasHeader && (
        <div className={`flex items-start justify-between gap-3 ${children != null ? 'mb-4' : ''}`}>
          <div className="min-w-0">
            {title != null && <h2 className="text-sm font-semibold text-fg">{title}</h2>}
            {description != null && <p className="mt-1 text-2xs leading-snug text-fg-muted">{description}</p>}
          </div>
          {actions != null && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
