/**
 * The button. shadcn/ui's shape, ReportLog's colour rules:
 *
 *   primary   the action you came to take. The action colour. One per view.
 *   secondary everything else.
 *   quiet     no fill and no outline, an underlined label: Cancel, Change, Clear.
 *
 * Every button is at least 44px tall (`md`); `lg` is 52px, for the page's
 * main action, full width on a phone with `block`. The 36px small button of
 * the old app does not come back: a thumb is not a mouse pointer. There is
 * deliberately no "danger" or "success" variant: those colours are status,
 * and status colour is never put on a button.
 *
 * OUTLINED IN EVERY THEME, in the text colour, because some palettes' action
 * colour is too close to their page to be found by its fill (Flint gold on
 * Flint grey is 1.7:1). Pressing it moves it into its own shadow.
 *
 * NOTHING FADES. A disabled button keeps readable text and says so with a
 * dashed edge; use one only where a sentence beside it says why. A busy one
 * is not disabled: it says what it is doing and ignores a second press.
 */
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps, MouseEvent, ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';

export const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 rounded-control text-center label-face text-[0.84375rem] leading-tight print:hidden',
    'border-control border-solid border-ink shadow-raised',
    'transition-[transform,box-shadow] duration-[120ms] active:translate-press active:shadow-pressed',
    'disabled:cursor-not-allowed disabled:border-dashed disabled:bg-paper-alt disabled:text-ink-alt disabled:shadow-none disabled:active:transform-none',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-action text-on-action',
        secondary: 'bg-surface text-ink hover:bg-paper-alt',
        quiet:
          'border-transparent bg-transparent px-2 text-ink underline underline-offset-4 shadow-none hover:decoration-2 active:shadow-none disabled:border-transparent disabled:bg-transparent',
      },
      size: {
        md: 'min-h-11 px-[1.125rem] py-2',
        lg: 'min-h-13 px-6 py-2 text-[0.90625rem]',
      },
      block: {
        true: 'flex w-full',
        false: '',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md', block: false },
  },
);

export interface ButtonProps
  extends Omit<ComponentProps<'button'>, 'children'>, VariantProps<typeof buttonVariants> {
  /** Render the child element (a link, say) with the button's look. */
  asChild?: boolean;
  children?: ReactNode;
  /**
   * Working on it: the label becomes `busyLabel` (the verb in progress,
   * "Sending…"), the button says it is busy, and a second press does nothing.
   * Not disabled, so focus stays where it was.
   */
  busy?: boolean;
  busyLabel?: ReactNode;
}

export function Button({
  className,
  variant,
  size,
  block,
  asChild = false,
  busy = false,
  busyLabel,
  children,
  onClick,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot.Root : 'button';
  // preventDefault also stops a busy submit button sending its form again.
  const guarded = busy
    ? (e: MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
      }
    : onClick;
  return (
    <Component
      className={cn(buttonVariants({ variant, size, block }), className)}
      aria-busy={busy || undefined}
      onClick={guarded}
      {...props}
    >
      {busy && busyLabel !== undefined ? busyLabel : children}
    </Component>
  );
}
