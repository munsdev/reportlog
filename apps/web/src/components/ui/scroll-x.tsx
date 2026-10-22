/**
 * A wide table on a narrow screen: it scrolls sideways inside this box
 * rather than pushing the page wider. The box is a named region a keyboard
 * can reach (Tab to it, then the arrow keys scroll), because a table of
 * plain text has nothing else in it that could take focus, and the columns
 * past the edge would otherwise be out of a keyboard's reach (WCAG 2.1.1).
 */
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils.ts';

export interface ScrollXProps extends ComponentProps<'div'> {
  /** What the table is, said when the box takes focus: "Who opened what". */
  label: string;
}

export function ScrollX({ label, className, ...props }: ScrollXProps) {
  return (
    <div
      role="region"
      aria-label={label}
      // A region that can take focus is the pattern axe and WCAG ask for here.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      className={cn('overflow-x-auto rounded-control', className)}
      {...props}
    />
  );
}
