import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils.ts';

/** The mock-up's status chip (`st`). The tone names match the old Chip's. */
export type StTone = 'confirmed' | 'serious' | 'open' | 'wait' | 'off' | 'flag' | 'tag';

const CLASS: Record<StTone, string> = {
  confirmed: 'ok',
  serious: 'bad',
  open: 'wait',
  wait: 'wait',
  off: 'off',
  flag: 'flag',
  tag: '',
};

export function St({
  tone = 'tag',
  className,
  ...props
}: ComponentProps<'span'> & { tone?: StTone | null | undefined }) {
  return <span className={cn('st', CLASS[tone ?? 'tag'], className)} {...props} />;
}
