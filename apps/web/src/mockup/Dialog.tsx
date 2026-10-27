/**
 * The mock-up's dialog (`dlg`: a title, words, an `acts` row) on Radix's
 * behaviour (focus trap, Escape, return of focus). The scrim is the
 * mock-up's dimming.
 */
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils.ts';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  style,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 65 }}
      />
      <DialogPrimitive.Content
        className={cn('dlg', className)}
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 70,
          width: 'calc(100% - 32px)',
          maxHeight: 'calc(100dvh - 32px)',
          overflowY: 'auto',
          ...style,
        }}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={className} style={{ display: 'grid', gap: 6 }} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('acts', className)} {...props} />;
}

export function DialogTitle(props: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title asChild {...props}>
      <h3>{props.children}</h3>
    </DialogPrimitive.Title>
  );
}

export function DialogDescription(props: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description {...props} />;
}
