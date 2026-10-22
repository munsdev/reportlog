/**
 * A message about the page: something worth knowing, something to watch,
 * something that went wrong, or something that was done.
 *
 *   note     quiet: the page's second ground. Most messages are this.
 *   warning  deep: a notice that must not be missed.
 *   serious  something went wrong. The serious colour on its edge and mark.
 *   done     something was done. Quiet, with a tick and the word "Done".
 *
 * "Done" is never teal. Teal says a moderator confirmed something, and a
 * saved setting is not that. The serious colour marks an edge, never fills a
 * button inside. Each tone also says itself in words for anybody who cannot
 * see it. A serious message interrupts a screen reader (`role="alert"`); the
 * others wait their turn (`role="status"`). Errors stay until they are
 * fixed; a passing confirmation of a switch is a toast, not this.
 */
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';
import { Tick } from './choice.tsx';

const alertVariants = cva('flex gap-3 rounded-card p-4', {
  variants: {
    tone: {
      note: 'bg-paper-alt text-ink',
      warning: 'bg-deep text-on-deep',
      serious:
        'border-(length:--rl-border-main) border-l-8 border-ink-alt border-l-serious bg-surface text-ink',
      done: 'bg-paper-alt text-ink',
    },
  },
  defaultVariants: { tone: 'note' },
});

const spoken = {
  note: 'Note: ',
  warning: 'Warning: ',
  serious: 'Problem: ',
  done: 'Done: ',
} as const;

type Tone = keyof typeof spoken;

function Mark({ tone }: { tone: Tone }) {
  if (tone === 'serious')
    return (
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-serious font-bold text-on-serious"
      >
        !
      </span>
    );
  if (tone === 'done')
    return (
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink text-paper-alt"
      >
        <Tick />
      </span>
    );
  return null;
}

export interface AlertProps
  extends Omit<ComponentProps<'div'>, 'title'>, VariantProps<typeof alertVariants> {
  title?: ReactNode;
}

export function Alert({ className, tone, title, children, role, ...props }: AlertProps) {
  const t: Tone = tone ?? 'note';
  const quiet = t === 'warning' ? 'text-on-deep-muted' : 'text-ink-alt';
  return (
    <div
      role={role ?? (t === 'serious' ? 'alert' : 'status')}
      className={cn(alertVariants({ tone: t }), className)}
      {...props}
    >
      <Mark tone={t} />
      <div className="flex min-w-0 flex-col gap-1">
        {t === 'done' ? (
          <p aria-hidden="true" className="label-face text-xs">
            Done
          </p>
        ) : null}
        {title ? (
          <p className="font-semibold">
            <span className="sr-only">{spoken[t]}</span>
            {title}
          </p>
        ) : (
          <span className="sr-only">{spoken[t]}</span>
        )}
        {children ? <div className={quiet}>{children}</div> : null}
      </div>
    </div>
  );
}
