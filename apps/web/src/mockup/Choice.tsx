import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';

/** The mock-up's list of answer tiles (site.css `.choices`). */
export function Choices({ className, ...props }: ComponentProps<'div'>) {
  return <div {...props} className={cn('choices', className)} />;
}

/**
 * One answer tile: a radio, or with `multi` a tick box, drawn as the
 * mock-up's `.choice` with its `.dot`. The input is a real one, so a keyboard
 * and a screen reader get what they always did.
 */
export function Choice({
  multi = false,
  children,
  ...input
}: Omit<ComponentProps<'input'>, 'type' | 'children'> & {
  multi?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={cn('choice', multi && 'multi')}>
      <input {...input} type={multi ? 'checkbox' : 'radio'} />
      <span className="dot" aria-hidden="true" />
      {children}
    </label>
  );
}
