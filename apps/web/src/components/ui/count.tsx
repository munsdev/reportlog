/**
 * A count in a pill: how many of something there are.
 *
 * `action` only inside the Menu button, for the work waiting for this
 * person, which makes it part of a button and so allowed the action colour.
 * `neutral` everywhere else. `onDeep` for a count on the deep surface (the
 * menu panel). Always given a sentence to say, because "7" on its own tells
 * a screen reader nothing: "7 reports waiting for a moderator".
 */
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils.ts';

export const countVariants = cva(
  'inline-flex h-5 min-w-[1.375rem] shrink-0 items-center justify-center rounded-pill px-1.5 font-mono text-xs leading-none font-medium tracking-normal normal-case',
  {
    variants: {
      tone: {
        action: 'bg-action text-on-action',
        neutral: 'bg-paper-alt text-ink',
        onDeep: 'bg-line-on-deep text-on-deep',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface CountProps
  extends Omit<ComponentProps<'span'>, 'children'>, VariantProps<typeof countVariants> {
  value: number;
  /** What the number means, said in full instead of the bare figure. */
  label: string;
}

export function Count({ className, tone, value, label, ...props }: CountProps) {
  return (
    <span className={cn(countVariants({ tone }), className)} {...props}>
      <span aria-hidden="true">{value}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
