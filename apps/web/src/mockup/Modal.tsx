import { Dialog } from 'radix-ui';
import type { ReactNode } from 'react';

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
      <Dialog.Title asChild>
        <h3>{title}</h3>
      </Dialog.Title>
      {said ? (
        <Dialog.Description asChild>
          <p className="muted">{said}</p>
        </Dialog.Description>
      ) : (
        <Dialog.Description className="vh">{title}</Dialog.Description>
      )}
      {children}
      <div className="acts">{buttons}</div>
    </>
  );
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(on) => {
        if (!on) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dlg-scrim" />
        <Dialog.Content className="dlg modal" aria-label={title}>
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
