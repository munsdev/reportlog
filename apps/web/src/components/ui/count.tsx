/**
 * A count in a pill: how many of something there are.
 *
 * `action` only inside the Menu button, for the work waiting for this
 * person, which makes it part of a button and so allowed the action colour.
 * `neutral` everywhere else. `onDeep` for a count on the deep surface (the
 * menu panel). Always given a sentence to say, because "7" on its own tells
 * a screen reader nothing: "7 reports waiting for a moderator".
 */
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils.ts';

export interface CountProps extends Omit<ComponentProps<'span'>, 'children'> {
  value: number;
  /** What the number means, said in full instead of the bare figure. */
  label: string;
}

/** The mock-up's `.n` count chip. */
export function Count({ className, value, label, ...props }: CountProps) {
  return (
    <span className={cn('n', className)} {...props}>
      <span aria-hidden="true">{value}</span>
      <span className="vh">{label}</span>
    </span>
  );
}
