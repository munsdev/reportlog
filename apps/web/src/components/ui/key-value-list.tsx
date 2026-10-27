/**
 * Facts as name and value: a setting's current values, a report's details.
 * Two columns from a small tablet up, stacked on a phone, where a second
 * column would leave each value a few words wide. Names in the second text
 * colour, values in the first; codes and counts in mono, so a reference
 * reads as one.
 */
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';

export interface KeyValue {
  key: ReactNode;
  value: ReactNode;
  /** A code, a count or a hash: set in the mono face. */
  mono?: boolean | undefined;
}

export interface KeyValueListProps extends Omit<ComponentProps<'dl'>, 'children'> {
  items: readonly KeyValue[];
}

export function KeyValueList({ items, className, ...props }: KeyValueListProps) {
  return (
    <dl
      className={cn(
        'm-0 grid grid-cols-1 border-t border-line sm:grid-cols-[minmax(0,12.5rem)_minmax(0,1fr)] sm:gap-x-3.5',
        className,
      )}
      {...props}
    >
      {items.map((item, i) => (
        // A <div> around each pair is allowed inside <dl>, and keeps a name
        // and its value together for anybody reading the source order.
        <div key={i} className="contents">
          <dt className="pt-2.5 font-mono text-[0.74rem] tracking-[0.06em] text-muted uppercase sm:border-b sm:border-line sm:pb-2.5">
            {item.key}
          </dt>
          <dd
            className={cn(
              'm-0 border-b border-line pb-2.5 font-medium text-ink sm:pt-2.5',
              item.mono && 'font-mono text-sm',
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
