import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';

export interface DlItem {
  key: ReactNode;
  value: ReactNode;
  mono?: boolean | undefined;
}

/** The mock-up's `dl`: a term and its value per line. */
export function Dl({
  items,
  className,
  ...props
}: Omit<ComponentProps<'dl'>, 'children'> & { items: readonly DlItem[] }) {
  return (
    <dl className={cn('dl', className)} {...props}>
      {items.map((item, i) => (
        <div key={i}>
          <dt>{item.key}</dt>
          <dd className={item.mono ? 'mono' : undefined}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
