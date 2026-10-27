import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';

/** The mock-up's `empty`: a dashed box with a title and a line. */
export function Empty({
  title,
  className,
  children,
  ...props
}: Omit<ComponentProps<'div'>, 'title'> & { title: ReactNode }) {
  return (
    <div className={cn('empty', className)} {...props}>
      <h3>{title}</h3>
      {children ? <p className="muted">{children}</p> : null}
    </div>
  );
}
