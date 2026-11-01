import { forwardRef, type InputHTMLAttributes } from 'react';
import { field } from '@renderer/theme/classes';
import { useFieldFocusable } from '@renderer/input/spatialNav';

/**
 * Text input primitive. Consumes the shared `field` token recipe so every input
 * looks identical app-wide. Forwards all native input props (value, onChange,
 * type, placeholder, inputMode, disabled, …) and a ref. Reachable by controller and
 * arrow keys: Enter/A starts typing, Escape/B stops (see useFieldFocusable).
 */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className = '', onFocus, onBlur, onKeyDown, ...props },
  ref,
) {
  const nav = useFieldFocusable<HTMLInputElement>(ref);
  return (
    <input
      ref={nav.ref}
      className={`${field} ${nav.focused ? 'bg-bg ring-1 ring-accent/60' : ''} ${className}`}
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
    />
  );
});
