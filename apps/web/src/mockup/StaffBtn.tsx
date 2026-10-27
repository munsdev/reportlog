import { Slot } from 'radix-ui';
import type { ComponentProps, MouseEvent, ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';

/**
 * The mock-up's button. A staff screen's buttons are `btn sm flat`: the
 * "primary" one is `ink`, a quiet one `ghost`, a destructive one `bad`.
 * `btnClass` is for a link dressed as a button.
 */
export type BtnVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

const CLASS: Record<BtnVariant, string> = {
  primary: 'btn sm flat ink',
  secondary: 'btn sm flat',
  quiet: 'btn sm flat ghost',
  danger: 'btn sm flat bad',
};

export function btnClass(variant: BtnVariant = 'primary'): string {
  return CLASS[variant];
}

export interface BtnProps extends Omit<ComponentProps<'button'>, 'children'> {
  variant?: BtnVariant | null | undefined;
  asChild?: boolean;
  children?: ReactNode;
  busy?: boolean;
  busyLabel?: ReactNode;
}

export function Btn({
  className,
  variant,
  asChild = false,
  busy = false,
  busyLabel,
  children,
  onClick,
  type,
  ...props
}: BtnProps) {
  const Component = asChild ? Slot.Root : 'button';
  // preventDefault also stops a busy submit button sending its form again.
  const guarded = busy
    ? (e: MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
      }
    : onClick;
  return (
    <Component
      className={cn(btnClass(variant ?? 'primary'), className)}
      aria-busy={busy || undefined}
      onClick={guarded}
      {...(asChild ? {} : { type: type ?? 'button' })}
      {...props}
    >
      {busy && busyLabel !== undefined ? busyLabel : children}
    </Component>
  );
}
