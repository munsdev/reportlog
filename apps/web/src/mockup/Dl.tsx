import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';

export interface DlItem {
  key: ReactNode;
  value: ReactNode;
  mono?: boolean | undefined;
}

/** The mock-up's `.dl` term list. An item is `{ key, value }` or a `[key, value]` pair. */
export function Dl({
  items,
  className,
  ...props
}: Omit<ComponentProps<'dl'>, 'children'> & {
  items: readonly (DlItem | readonly [ReactNode, ReactNode])[];
}) {
  return (
    <dl className={cn('dl', className)} {...props}>
      {items.map((item, i) => {
        const [key, value, mono] = Array.isArray(item)
          ? [item[0], item[1], false]
          : [(item as DlItem).key, (item as DlItem).value, (item as DlItem).mono];
        return (
          <div key={i}>
            <dt>{key}</dt>
            <dd className={mono ? 'mono' : undefined}>{value}</dd>
          </div>
        );
      })}
    </dl>
  );
}
