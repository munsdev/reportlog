import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';

/**
 * The mock-up's button (site.css `.btn`): `go` is the action colour, `ink` the
 * dark fill, `ghost` no fill and no shadow; `sm`, `lg` and `flat` are its
 * sizes and shadow. A link dressed as a button is `BtnLink`.
 */
export interface BtnLook {
  look?: 'go' | 'ink' | 'ghost' | undefined;
  sm?: boolean | undefined;
  lg?: boolean | undefined;
  flat?: boolean | undefined;
}

export const btnClass = ({ look, sm, lg, flat }: BtnLook, extra?: string) =>
  cn('btn', look, sm && 'sm', lg && 'lg', flat && 'flat', extra);

export function Btn({
  look,
  sm,
  lg,
  flat,
  className,
  busy = false,
  busyLabel,
  children,
  onClick,
  type = 'button',
  ...props
}: BtnLook &
  Omit<ComponentProps<'button'>, 'children'> & {
    /** Working on it: the label says what it is doing and a second press does nothing. */
    busy?: boolean;
    busyLabel?: ReactNode;
    children?: ReactNode;
  }) {
  return (
    <button
      {...props}
      type={type}
      className={btnClass({ look, sm, lg, flat }, className)}
      aria-busy={busy || undefined}
      onClick={
        busy
          ? (e) => {
              e.preventDefault();
            }
          : onClick
      }
    >
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}

export function BtnLink({
  look,
  sm,
  lg,
  flat,
  className,
  children,
  ...props
}: BtnLook & ComponentProps<'a'>) {
  return (
    <a {...props} className={btnClass({ look, sm, lg, flat }, className)}>
      {children}
    </a>
  );
}
