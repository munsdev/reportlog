import './panel.css';

import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';

/**
 * The mock-up's `.panel` (staff.py `panel`): a titled box. `kind` is deep,
 * quiet, danger or closed; a closed panel is the summary form, its heading in
 * `.closed-head` (with `head`, something at the right of it such as a status
 * chip) above a `dl` and an `acts` row.
 */
export function Panel({
  title,
  sub,
  kind,
  head,
  headingLevel = 2,
  as: Tag = 'section',
  className,
  children,
  ...rest
}: Omit<ComponentProps<'section'>, 'title'> & {
  title?: ReactNode;
  sub?: ReactNode;
  kind?: 'deep' | 'quiet' | 'danger' | 'closed' | undefined;
  head?: ReactNode;
  headingLevel?: 2 | 3;
  as?: 'section' | 'article';
  /** data-* attributes a test or script looks for. */
  [attr: `data-${string}`]: string | boolean | undefined;
}) {
  const H = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <Tag className={cn('panel', kind, className)} {...rest}>
      {head || kind === 'closed' ? (
        title || head ? (
          <div className="closed-head">
            {title ? <H>{title}</H> : null}
            {head}
          </div>
        ) : null
      ) : title ? (
        <H>{title}</H>
      ) : null}
      {sub ? <p className="sub">{sub}</p> : null}
      {children}
    </Tag>
  );
}
