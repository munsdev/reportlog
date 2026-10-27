import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';

export type NoteTone = 'note' | 'warning' | 'serious' | 'done';

/** The mock-up's `note` strip, standing in for the old Alert. */
export function Note({
  tone = 'note',
  title,
  className,
  children,
  role,
  ...props
}: Omit<ComponentProps<'div'>, 'title'> & {
  tone?: NoteTone | null | undefined;
  title?: ReactNode;
}) {
  const t = tone ?? 'note';
  return (
    <div
      role={role ?? (t === 'serious' ? 'alert' : 'status')}
      className={cn('note', (t === 'serious' || t === 'warning') && 'warn', className)}
      {...props}
    >
      <div>
        {title ? <b>{title}</b> : null}
        {title && children ? <br /> : null}
        {children}
      </div>
    </div>
  );
}
