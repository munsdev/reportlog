/**
 * A choice from a list, as the browser's own `<select>`.
 *
 * Deliberately not Radix's custom listbox: the native control is the one
 * every screen reader, switch device and phone already knows, it opens the
 * phone's own picker, and it works before any script has loaded. Only its
 * box is styled.
 */
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils.ts';
import { useFieldControl } from './field.tsx';
import { controlClass } from './input.tsx';

export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  const wired = useFieldControl(props);
  return (
    <div className="relative">
      <select
        className={cn(controlClass, 'appearance-none pr-10', className)}
        {...props}
        {...wired}
      >
        {children}
      </select>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-ink-alt"
      >
        ▾
      </span>
    </div>
  );
}
