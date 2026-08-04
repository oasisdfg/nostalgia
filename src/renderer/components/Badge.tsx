import { type ReactNode } from 'react';

type Tone = 'neutral' | 'accent' | 'positive' | 'warning' | 'danger';

const TONE: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-fg-muted',
  accent: 'bg-accent/15 text-accent',
  positive: 'bg-positive/15 text-positive',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
};

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs font-medium capitalize ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}
