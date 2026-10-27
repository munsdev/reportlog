/**
 * A list of rows in one bordered box (the mock-up's `.rows`): a logbook and
 * its state, a person and their role, a batch and where it stands. Rows
 * share the box's edge and are told apart by a thin rule, so a long list
 * reads as one table rather than a stack of cards.
 *
 *   <Rows label="Logbooks" cols="end" head={['Logbook', '']}>
 *     <RowItem><span>…</span><Chip>…</Chip></RowItem>
 *   </Rows>
 *
 * `cols` names the grid from 820px up (`end`, `ref`); below it a row is stacked.
 * A row that leads somewhere is a link wearing `rowClass`, so the whole row
 * is the target. `head` draws the column names, for a table of facts.
 */
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';

/** The row's own measures, for a link or a button that is the whole row. */
export const rowClass = 'grid min-h-11 items-center gap-x-3.5 gap-y-1 px-3.5 py-3 text-ink';

/**
 * The grids a row can have from 820px up. Written out as whole class names
 * (Tailwind finds classes by reading the source) rather than set as an inline
 * style, which the Client-First test forbids on a component.
 */
const GRIDS = {
  /** A name, then one thing at the end: a state, a chip. */
  end: 'min-[820px]:grid-cols-[1fr_auto]',
  /** A reference, a line about it, then a state. */
  ref: 'min-[820px]:grid-cols-[180px_1fr_auto]',
} as const;
export type RowGrid = keyof typeof GRIDS;

/** A link or button that is the whole row. */
export const rowLink = (cols: RowGrid) =>
  cn(rowClass, GRIDS[cols], 'no-underline hover:bg-paper-alt');

export interface RowsProps extends Omit<ComponentProps<'ul'>, 'children'> {
  label: string;
  /** The grid columns from 820px up. */
  cols?: RowGrid;
  /** Column names, shown from 820px up. */
  head?: readonly ReactNode[];
  children?: ReactNode;
}

export function Rows({ label, cols, head, className, children, ...props }: RowsProps) {
  return (
    <div className="overflow-hidden rounded-card border-[1.5px] border-line bg-surface">
      {head ? (
        <div
          aria-hidden="true"
          className={cn(
            rowClass,
            cols && GRIDS[cols],
            'hidden border-b border-line bg-paper-alt py-2 font-mono text-[0.7rem] tracking-[0.1em] text-muted uppercase min-[820px]:grid',
          )}
        >
          {head.map((h, i) => (
            <span key={i}>{h}</span>
          ))}
        </div>
      ) : null}
      <ul aria-label={label} className={cn('m-0 list-none p-0', className)} {...props}>
        {children}
      </ul>
    </div>
  );
}

/** One row. Put a link wearing `rowLink(cols)` inside it when the row leads somewhere. */
export function RowItem({ className, children, ...props }: ComponentProps<'li'>) {
  return (
    <li className={cn('border-t border-line first:border-t-0', className)} {...props}>
      {children}
    </li>
  );
}
