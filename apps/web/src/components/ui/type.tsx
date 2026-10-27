/**
 * The type styles a page uses besides its headings. The theme decides the
 * faces; these decide which face a line wears.
 *
 *   Eyebrow    the site's name above a page title, in the label face
 *   Lede       the sentence under a title
 *   Meta       references, timestamps, hashes: mono
 *   CountLine  what a list holds, in one mono line that updates with its
 *              filters: "31 reports · 7 waiting · 19 approved"
 */
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils.ts';

export function Eyebrow({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('eyebrow', className)} {...props} />;
}

export function Lede({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('lede', className)} {...props} />;
}

export function Meta({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cn('m mono', className)} {...props} />;
}

export interface CountLineProps extends Omit<ComponentProps<'p'>, 'children'> {
  /** Each part already in words: "31 reports", "7 waiting". Empty parts are left out. */
  parts: readonly (string | null | false | undefined)[];
}

/**
 * Polite, so a screen reader hears the new totals after a filter changes,
 * once, without being interrupted.
 */
export function CountLine({ parts, className, ...props }: CountLineProps) {
  return (
    <p aria-live="polite" className={cn('m mono', className)} {...props}>
      {parts.filter(Boolean).join(' · ')}
    </p>
  );
}
