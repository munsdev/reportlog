import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';

/** The mock-up's `rows`: a bordered list whose rows share a column template. */
export function Rows({
  label,
  className,
  children,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & { label?: string; children?: ReactNode }) {
  return (
    <div className={cn('rows', className)} role="list" aria-label={label} {...props}>
      {children}
    </div>
  );
}

type Cols = CSSProperties & { '--cols'?: string };

/** One row. `cols` is the CSS grid template ("1fr auto"); `head` marks the header row. */
export function Row({
  cols = '1fr auto',
  head = false,
  className,
  style,
  ...props
}: ComponentProps<'div'> & { cols?: string; head?: boolean }) {
  const s: Cols = { '--cols': cols, ...style };
  return (
    <div role="listitem" className={cn('row', head && 'head', className)} style={s} {...props} />
  );
}

/** A row that is a link (the mock-up's `a.row`). */
export function RowLink({
  cols = '1fr auto',
  className,
  style,
  ...props
}: ComponentProps<'a'> & { cols?: string }) {
  const s: Cols = { '--cols': cols, ...style };
  return <a className={cn('row', className)} style={s} {...props} />;
}

/** The inline style a router `Link` with class `row` needs for its columns. */
export function rowCols(cols: string): CSSProperties {
  const s: Cols = { '--cols': cols };
  return s;
}
