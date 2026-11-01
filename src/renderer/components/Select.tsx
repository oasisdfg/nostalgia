import { forwardRef, type SelectHTMLAttributes, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { field } from '@renderer/theme/classes';
import { useFieldFocusable } from '@renderer/input/spatialNav';

/**
 * Native select primitive with consistent token styling and a custom chevron
 * (the native arrow is suppressed via appearance-none so it matches Input). Reachable by
 * controller and arrow keys: Enter/A starts choosing (arrows change the option), Escape/B
 * stops (see useFieldFocusable).
 */
export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }
>(function Select({ className = '', children, onFocus, onBlur, onKeyDown, ...props }, ref) {
  const nav = useFieldFocusable<HTMLSelectElement>(ref);
  return (
    <div className="relative">
      <select
        ref={nav.ref}
        className={`${field} cursor-pointer appearance-none pr-9 ${nav.focused ? 'bg-bg ring-1 ring-accent/60' : ''} ${className}`}
        onFocus={(e) => {
          nav.handlers.onFocus(e);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          nav.handlers.onBlur(e);
          onBlur?.(e);
        }}
        onKeyDown={(e) => {
          nav.handlers.onKeyDown(e);
          onKeyDown?.(e);
        }}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
    </div>
  );
});
