/**
 * A chip: a status or a fact, in words, with colour as the second signal.
 *
 *   confirmed  a moderator's outcome. Only "Confirmed" and its kin.
 *   serious    "Serious", or an error state.
 *   open       waiting, not assessed. No colour: a report nobody has
 *              assessed gets none.
 *   wait       waiting for somebody: a dashed edge
 *   off        switched off or not applicable: a faint edge
 *   flag       needs a look: the serious colour on the edge, not filled
 *   tag        a neutral fact: "Single account", "Counts only", "Not public".
 *
 * The status colours live here and on alerts' edges, never on a button, a
 * link or a "you are here" marker. Always uppercase in the label face,
 * whatever the theme's label case, so a chip reads as a stamp.
 */
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils.ts';

export const chipVariants = cva(
  'inline-flex h-6 shrink-0 items-center rounded-pill px-[0.5625rem] label-face text-[0.6875rem] leading-none tracking-[0.08em] whitespace-nowrap uppercase',
  {
    variants: {
      tone: {
        confirmed: 'bg-confirmed text-on-confirmed',
        serious: 'bg-serious text-on-serious',
        open: 'border-[1.5px] border-dashed border-ink-alt text-ink-alt',
        /** Waiting for somebody: the mock-up's dashed chip. */
        wait: 'border-[1.5px] border-dashed border-ink text-ink',
        /** A state that is off or not applicable: faint edge. */
        off: 'border-[1.5px] border-line text-muted',
        /** Needs a look: the serious colour on the edge only. */
        flag: 'border-[1.5px] border-serious text-serious',
        tag: 'border-[1.5px] border-ink text-ink',
      },
    },
    defaultVariants: { tone: 'tag' },
  },
);

export interface ChipProps extends ComponentProps<'span'>, VariantProps<typeof chipVariants> {}

export function Chip({ className, tone, ...props }: ChipProps) {
  return <span className={cn(chipVariants({ tone }), className)} {...props} />;
}
