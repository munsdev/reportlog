/**
 * Moving through pages of a list: Previous and Next as secondary buttons,
 * "Page 2 of 7" in mono between them. A button with nowhere to go is left
 * out rather than disabled, so nothing on the row is a dead control.
 */
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils.ts';
import { Button } from './button.tsx';

export interface PaginationProps extends Omit<ComponentProps<'nav'>, 'onChange'> {
  /** 1-based. */
  page: number;
  pages: number;
  onPage: (page: number) => void;
  /** What is being paged through, for the landmark's name: "Reports". */
  label?: string;
}

export function Pagination({
  page,
  pages,
  onPage,
  label = 'Pages',
  className,
  ...props
}: PaginationProps) {
  if (pages <= 1) return null;
  return (
    <nav
      aria-label={label}
      className={cn('flex flex-wrap items-center gap-3 print:hidden', className)}
      {...props}
    >
      {page > 1 ? (
        <Button
          variant="secondary"
          onClick={() => {
            onPage(page - 1);
          }}
        >
          Previous
        </Button>
      ) : null}
      <p className="font-mono text-sm" aria-live="polite">
        Page {page} of {pages}
      </p>
      {page < pages ? (
        <Button
          variant="secondary"
          onClick={() => {
            onPage(page + 1);
          }}
        >
          Next
        </Button>
      ) : null}
    </nav>
  );
}
