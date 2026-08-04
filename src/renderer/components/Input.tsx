import { forwardRef, type InputHTMLAttributes } from 'react';
import { field } from '@renderer/theme/classes';

/**
 * Text input primitive. Consumes the shared `field` token recipe so every input
 * looks identical app-wide. Forwards all native input props (value, onChange,
 * type, placeholder, inputMode, disabled, …) and a ref.
 */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className = '', ...props },
  ref,
) {
  return <input ref={ref} className={`${field} ${className}`} {...props} />;
});
