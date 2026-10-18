/**
 * A message about the page: something went wrong, something was done, or
 * something worth knowing.
 *
 *   note       no colour at all. Most messages are this.
 *   confirmed  something was done. The confirmed colour, on its edge only.
 *   serious    something went wrong. The serious colour, on its edge only.
 *
 * The colour is a status colour, so it marks the edge and never fills a
 * button inside. Each tone also says itself in words for anybody who cannot
 * see the colour. A serious message interrupts a screen reader
 * (`role="alert"`); the others wait their turn (`role="status"`).
 */
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';

const alertVariants = cva(
  'flex flex-col gap-1 rounded-card border border-l-8 bg-surface p-4 text-ink',
  {
    variants: {
      tone: {
        note: 'border-line border-l-ink-alt',
        confirmed: 'border-line border-l-confirmed',
        serious: 'border-line border-l-serious',
      },
    },
    defaultVariants: { tone: 'note' },
  },
);

const spoken = { note: 'Note: ', confirmed: 'Done: ', serious: 'Problem: ' } as const;

export interface AlertProps
  extends Omit<ComponentProps<'div'>, 'title'>, VariantProps<typeof alertVariants> {
  title?: ReactNode;
}

export function Alert({ className, tone, title, children, role, ...props }: AlertProps) {
  const t = tone ?? 'note';
  return (
    <div
      role={role ?? (t === 'serious' ? 'alert' : 'status')}
      className={cn(alertVariants({ tone: t }), className)}
      {...props}
    >
      {title ? (
        <p className="font-semibold">
          <span className="sr-only">{spoken[t]}</span>
          {title}
        </p>
      ) : (
        <span className="sr-only">{spoken[t]}</span>
      )}
      {children ? <div className="text-ink-alt">{children}</div> : null}
    </div>
  );
}
