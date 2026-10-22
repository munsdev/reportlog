/**
 * Nothing to show, said as a state rather than a stray sentence: a dashed
 * box with a short title and one sentence of what happens next.
 *
 *   <Empty title="Nothing waiting">New reports appear here when they are filed.</Empty>
 */
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';

export interface EmptyProps extends Omit<ComponentProps<'div'>, 'title'> {
  title: ReactNode;
}

export function Empty({ title, className, children, ...props }: EmptyProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-card border-2 border-dashed border-ink-alt px-6 py-10 text-center',
        className,
      )}
      {...props}
    >
      <p className="label-face text-sm text-ink">{title}</p>
      {children ? <p className="max-w-prose text-ink-alt">{children}</p> : null}
    </div>
  );
}
