import { type ReactNode } from 'react';
import { Label } from './Label';

/**
 * Label + control + optional hint, owning the spacing between them. The label is
 * optional: omit it when the control is self-evident from its placeholder/context
 * (the labeling convention - no redundant labels). The hint is helper text, not a
 * label, so it may use the micro size.
 */
export function FormField({
  label,
  hint,
  htmlFor,
  children,
  className = '',
}: {
  label?: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      {label != null && <Label htmlFor={htmlFor}>{label}</Label>}
      {children}
      {hint != null && <p className="text-2xs leading-snug text-fg-faint">{hint}</p>}
    </div>
  );
}
