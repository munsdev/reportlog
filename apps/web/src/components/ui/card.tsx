/**
 * A panel: a surface that groups one thing. It carries no status colour of
 * its own; a panel about something serious says so in words inside it.
 *
 *   raised  (default) the surface, an edge and the theme's shadow. Holds a
 *           decision, a setting, a report.
 *   danger  as raised, with the serious colour on its edge: delete, erase.
 *   quiet   the page's second ground, no edge. Help, side information.
 *   deep    the deep surface. A notice that must not be missed.
 *   plain   no fill, a rule on top. A section of a long settings page.
 *
 * Give it a `heading` and the heading follows the theme (`data-panel-head`
 * on <html>): a striped title bar, a deep bar, a double rule, a dashed rule,
 * a prompt, or plain. The shapes are drawn in styles.css (`.panel-head`);
 * they are decoration around a real heading and hidden from screen readers.
 * A theme chooses between these; it cannot describe a new one.
 */
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { useId } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';

export const cardVariants = cva('panel flex flex-col rounded-card', {
  variants: {
    variant: {
      raised: 'border-(length:--rl-border-main) border-ink-alt bg-surface text-ink shadow-raised',
      /** Something that cannot be undone: the serious colour on the edge only. */
      danger: 'border-(length:--rl-border-main) border-serious bg-surface text-ink shadow-raised',
      quiet: 'bg-paper-alt text-ink',
      deep: 'bg-deep text-on-deep',
      plain: 'rounded-none border-t border-ink-alt text-ink',
    },
  },
  defaultVariants: { variant: 'raised' },
});

export interface CardProps
  extends Omit<ComponentProps<'div'>, 'title'>, VariantProps<typeof cardVariants> {
  /** The panel's title, drawn in the theme's panel heading. */
  heading?: ReactNode;
  /** Level 2 by default; pass 3 when the panel sits under a section heading. */
  headingLevel?: 2 | 3;
}

export function Card({
  className,
  variant,
  heading,
  headingLevel = 2,
  children,
  ...props
}: CardProps) {
  const v = variant ?? 'raised';
  // A danger panel wears the raised panel's theme heading; only its edge differs.
  const themed = v === 'danger' ? 'raised' : v;
  const headingId = useId();
  if (heading === undefined) {
    return (
      <div
        data-variant={themed}
        className={cn(cardVariants({ variant: v }), 'gap-4 p-5', className)}
        {...props}
      >
        {children}
      </div>
    );
  }
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <section
      aria-labelledby={headingId}
      data-variant={themed}
      className={cn(cardVariants({ variant: v }), 'overflow-hidden', className)}
      {...props}
    >
      <div className="panel-head">
        <Heading id={headingId} className="panel-title">
          {heading}
        </Heading>
      </div>
      <div className="flex flex-col gap-4 p-5 pt-4">{children}</div>
    </section>
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1', className)} {...props} />;
}

/**
 * A heading inside a panel that has no `heading` of its own. Level 2 by
 * default; pass `as` when the page needs another. It takes the theme's
 * dashed rule or prompt, which need no strip across the panel's top.
 */
export function CardTitle({
  className,
  as: Heading = 'h2',
  ...props
}: ComponentProps<'h2'> & { as?: 'h2' | 'h3' | 'h4' }) {
  return (
    <Heading
      className={cn('panel-title-inline font-display text-lg font-bold', className)}
      {...props}
    />
  );
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
