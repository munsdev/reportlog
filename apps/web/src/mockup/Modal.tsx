import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils.ts';

/**
 * The mock-up's `.dlg`, made a real dialog: the same box (title, body,
 * buttons in `.acts`) over a scrim, with focus kept inside and Escape
 * closing it. `buttons` are the mock-up's `Btn`s; Cancel closes with
 * `onClose`. Wrap the body and buttons in a form by passing `as="form"`.
 */
export function Modal({
  title,
  description,
  text,
  open,
  onClose,
  buttons,
  onSubmit,
  children,
}: {
  title: string;
  description?: ReactNode;
  /** The older name for `description`, still used by pages ported before the two merged. */
  text?: ReactNode;
  open: boolean;
  onClose: () => void;
  buttons: ReactNode;
  /** When given, the box is a form and the buttons' submit button submits it. */
  onSubmit?: () => void;
  children?: ReactNode;
}) {
  const said = description ?? text;
  const inner = (
    <>
      <DialogPrimitive.Title asChild>
        <h3>{title}</h3>
      </DialogPrimitive.Title>
      {said ? (
        <DialogPrimitive.Description asChild>
          <p className="muted">{said}</p>
        </DialogPrimitive.Description>
      ) : (
        <DialogPrimitive.Description className="vh">{title}</DialogPrimitive.Description>
      )}
      {children}
      <div className="acts">{buttons}</div>
    </>
  );
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(on) => {
        if (!on) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dlg-scrim" />
        <DialogPrimitive.Content className="dlg modal" aria-label={title}>
          {onSubmit ? (
            <form
              noValidate
              style={{ display: 'grid', gap: 12 }}
              onSubmit={(e) => {
                e.preventDefault();
                onSubmit();
              }}
            >
              {inner}
            </form>
          ) : (
            inner
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** The mock-up's `.dlg` box drawn in the page, not over it (a step, not a modal). */
export function Dlg({
  title,
  buttons,
  children,
}: {
  title: string;
  buttons: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="dlg" role="dialog" aria-label={title}>
      <h3>{title}</h3>
      {children}
      <div className="acts">{buttons}</div>
    </div>
  );
}

/*
 * The same modal box in pieces, for a dialog whose trigger, body and buttons
 * are written out by the screen: Radix's behaviour (focus trap, Escape,
 * return of focus) under the mock-up's `dlg` and its scrim.
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dlg-scrim" />
      <DialogPrimitive.Content className={cn('dlg modal', className)} {...props}>
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
