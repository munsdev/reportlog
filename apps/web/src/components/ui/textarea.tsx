/** A text area for a longer answer. Same edge and states as a text field. */
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils.ts';
import { useFieldControl } from './field.tsx';
import { controlClass } from './input.tsx';

export function Textarea({ className, rows = 5, ...props }: ComponentProps<'textarea'>) {
  const wired = useFieldControl(props);
  return (
    <textarea
      rows={rows}
      className={cn(controlClass, 'min-h-24', className)}
      {...props}
      {...wired}
    />
  );
}
