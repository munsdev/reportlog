import type { ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';

/** The mock-up's note (site.css `.note`): `lock` is dashed, `warn` has the serious edge. */
export function Note({
  lock = false,
  warn = false,
  children,
  ...rest
}: {
  lock?: boolean;
  warn?: boolean;
  children: ReactNode;
  role?: 'alert' | 'status';
  id?: string | undefined;
}) {
  return (
    <div {...rest} className={cn('note', lock && 'lock', warn && 'warn')}>
      <span>{children}</span>
    </div>
  );
}
