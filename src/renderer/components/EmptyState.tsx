import { type ReactNode } from 'react';

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center animate-fade-in">
      {icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-fg-faint">
          {icon}
        </div>
      )}
      <p className="text-base font-medium text-fg">{title}</p>
      {hint && <p className="max-w-sm text-sm text-fg-muted">{hint}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
