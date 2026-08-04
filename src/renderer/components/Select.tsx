import { forwardRef, type SelectHTMLAttributes, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { field } from '@renderer/theme/classes';

/**
 * Native select primitive with consistent token styling and a custom chevron
 * (the native arrow is suppressed via appearance-none so it matches Input).
 */
export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }
>(function Select({ className = '', children, ...props }, ref) {
  return (
    <div className="relative">
      <select ref={ref} className={`${field} cursor-pointer appearance-none pr-9 ${className}`} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-faint" />
    </div>
  );
});
