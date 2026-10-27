import { Slot } from 'radix-ui';
import type { ComponentProps, MouseEvent, ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';

/**
 * The mock-up's button (site.css `.btn`): `go` is the action colour, `ink` the
 * dark fill, `ghost` no fill and no shadow, `bad` the destructive one; `sm`,
 * `lg` and `flat` are its sizes and shadow. A staff screen's buttons are
 * `sm flat`. A link dressed as a button is `BtnLink`, or `btnClass` on a router
 * link; `asChild` dresses the one child instead.
 */
export interface BtnLook {
  look?: 'go' | 'ink' | 'ghost' | 'bad' | undefined;
  sm?: boolean | undefined;
  lg?: boolean | undefined;
  flat?: boolean | undefined;
}

export const btnClass = ({ look, sm, lg, flat }: BtnLook = {}, extra?: string) =>
  cn('btn', look, sm && 'sm', lg && 'lg', flat && 'flat', extra);

export function Btn({
  look,
  sm,
  lg,
  flat,
  className,
  asChild = false,
  busy = false,
  busyLabel,
  children,
  onClick,
  type,
  ...props
}: BtnLook &
  Omit<ComponentProps<'button'>, 'children'> & {
    asChild?: boolean;
    /** Working on it: the label says what it is doing and a second press does nothing. */
    busy?: boolean;
    busyLabel?: ReactNode;
    children?: ReactNode;
  }) {
  const Component = asChild ? Slot.Root : 'button';
  // preventDefault also stops a busy submit button sending its form again.
  const guarded = busy
    ? (e: MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
      }
    : onClick;
  return (
    <Component
      className={btnClass({ look, sm, lg, flat }, className)}
      aria-busy={busy || undefined}
      onClick={guarded}
      {...(asChild ? {} : { type: type ?? 'button' })}
      {...props}
    >
      {busy && busyLabel !== undefined && busyLabel !== null ? busyLabel : children}
    </Component>
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
