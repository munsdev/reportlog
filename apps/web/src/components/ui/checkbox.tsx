/**
 * A checkbox: Radix's, so it is a real `role="checkbox"` that Space toggles,
 * and it still submits with a plain form. Pair it with a `<Label>` beside
 * it; inside a `<Field>` the label finds it.
 */
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils.ts';
import { useFieldControl } from './field.tsx';

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  const wired = useFieldControl(props);
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'peer flex size-6 shrink-0 items-center justify-center rounded-control border-2 border-ink-alt bg-surface text-ink disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-serious',
        className,
      )}
      {...props}
      {...wired}
    >
      <CheckboxPrimitive.Indicator className="text-base leading-none font-bold" aria-hidden="true">
        ✓
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
