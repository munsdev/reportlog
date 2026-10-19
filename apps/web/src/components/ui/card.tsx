/**
 * A card: a bordered surface that groups one thing. It carries no colour of
 * its own; a card about something serious says so in words inside it.
 */
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils.ts';

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 rounded-card border-(length:--rl-border-main) border-line bg-surface p-5 text-ink shadow-raised',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1', className)} {...props} />;
}

/** The card's heading. Level 2 by default; pass `as` when the page needs another. */
export function CardTitle({
  className,
  as: Heading = 'h2',
  ...props
}: ComponentProps<'h2'> & { as?: 'h2' | 'h3' | 'h4' }) {
  return <Heading className={cn('font-display text-lg font-bold', className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-sm text-ink-alt', className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-3', className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-wrap items-center gap-3', className)} {...props} />;
}
