import type { ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';

/**
 * The mock-up's note (site.css `.note`): `lock` is dashed, `warn` has the serious
 * edge. A plain note is a status for a screen reader unless the caller says otherwise.
 */
export function Note({
  lock = false,
  warn = false,
  role,
  id,
  children,
}: {
  lock?: boolean;
  warn?: boolean;
  role?: 'alert' | 'status';
  id?: string | undefined;
  children?: ReactNode;
}) {
  const said = role ?? (warn ? undefined : 'status');
  return (
    <div
      className={cn('note', lock && 'lock', warn && 'warn')}
      {...(said ? { role: said } : {})}
      {...(id ? { id } : {})}
    >
      <span>{children}</span>
    </div>
  );
}
