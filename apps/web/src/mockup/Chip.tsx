import type { ReactNode } from 'react';

/** The mock-up's status chip (`.st`): kind is ok, wait, flag, off or none. */
export function Chip({
  kind = '',
  children,
}: {
  kind?: 'ok' | 'wait' | 'flag' | 'off' | '';
  children?: ReactNode;
}) {
  return <span className={kind ? `st ${kind}` : 'st'}>{children}</span>;
}
