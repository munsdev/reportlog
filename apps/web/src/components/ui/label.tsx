/**
 * A label. Inside a `<Field>` it labels the field's control without being
 * told which; outside one, give it `htmlFor`.
 */
import { Label as LabelPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils.ts';
import { useField } from './field.tsx';

export interface LabelProps extends ComponentProps<typeof LabelPrimitive.Root> {
  /** Say "(optional)" after the words. Required is the default, so it is the one left unsaid. */
  optional?: boolean;
}

export function Label({
  className,
  htmlFor,
  id,
  optional = false,
  children,
  ...props
}: LabelProps) {
  const field = useField();
  // A label given its own target is labelling something else inside the
  // field (one option of a radio group), so it takes none of the field's ids.
  const own = htmlFor === undefined && field !== null;
  return (
    <LabelPrimitive.Root
      htmlFor={own ? field.controlId : htmlFor}
      id={id ?? (own ? field.labelId : undefined)}
      className={cn('font-semibold text-ink', className)}
      {...props}
    >
      {children}
      {optional ? <span className="font-normal text-ink-alt"> (optional)</span> : null}
    </LabelPrimitive.Root>
  );
}
