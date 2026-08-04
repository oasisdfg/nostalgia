import { type ReactNode } from 'react';

/**
 * A sentence-case form label. Replaces the old all-caps `labelText` micro-label.
 * Use only where the control isn't self-evident from its placeholder/context.
 */
export function Label({
  htmlFor,
  children,
  className = '',
}: {
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label htmlFor={htmlFor} className={`block text-sm font-medium text-fg ${className}`}>
      {children}
    </label>
  );
}
