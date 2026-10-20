/**
 * A text field. Its border is the darker text colour rather than the
 * hairline colour, because a field's edge has to reach 3:1 against the page
 * to be found at all (WCAG 1.4.11), and the hairline does not.
 */
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils.ts';
import { useFieldControl } from './field.tsx';

export const controlClass =
  'min-h-11 w-full rounded-control border border-ink-alt bg-surface px-3 py-2 text-ink placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-2 aria-invalid:border-serious';

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  const wired = useFieldControl(props);
  return <input type={type} className={cn(controlClass, className)} {...props} {...wired} />;
}
