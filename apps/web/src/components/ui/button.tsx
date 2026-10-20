/**
 * The button. shadcn/ui's shape, ReportLog's colour rules:
 *
 *   primary   the action you came to take. Gold, dark text. One per screen.
 *   secondary everything else.
 *   quiet     a link that behaves like a button.
 *
 * Every button is at least 44px tall (min-h-11), as legacy's were: a thumb is
 * not a mouse pointer. There is deliberately no "danger" or "success" variant: those colours are
 * status, and status colour is never put on a button.
 */
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils.ts';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-control font-semibold transition disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-action text-on-action hover:brightness-95',
        secondary: 'border border-line bg-surface text-ink hover:bg-paper-alt',
        quiet: 'text-ink underline-offset-4 hover:underline',
      },
      size: {
        md: 'min-h-11 px-5 py-2',
        sm: 'min-h-11 px-3 py-1 text-sm',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  /** Render the child element (a link, say) with the button's look. */
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Component = asChild ? Slot.Root : 'button';
  return <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
