import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';

export type PanelVariant = 'raised' | 'danger' | 'quiet' | 'deep' | 'plain';

/**
 * The mock-up's `panel`: an h2 as its first child, then the content in the
 * panel's own grid. `closed` is the summary form with its heading in
 * `closed-head`, above a `dl` and an `acts` row.
 */
export function Panel({
  heading,
  variant = 'raised',
  closed = false,
  sub,
  headingLevel = 2,
  className,
  children,
  ...props
}: Omit<ComponentProps<'section'>, 'title'> & {
  heading?: ReactNode;
  variant?: PanelVariant | null | undefined;
  closed?: boolean;
  sub?: ReactNode;
  headingLevel?: 2 | 3;
}) {
  const H = headingLevel === 3 ? 'h3' : 'h2';
  const v = variant ?? 'raised';
  return (
    <section
      className={cn(
        'panel',
        v === 'danger' && 'danger',
        v === 'quiet' && 'quiet',
        v === 'deep' && 'deep',
        closed && 'closed',
        className,
      )}
      {...props}
    >
      {heading === undefined ? null : closed ? (
        <div className="closed-head">
          <H>{heading}</H>
        </div>
      ) : (
        <H>{heading}</H>
      )}
      {sub ? <p className="sub">{sub}</p> : null}
      {children}
    </section>
  );
}
