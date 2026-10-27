import { Dialog } from 'radix-ui';
import type { ReactNode } from 'react';

/**
 * A question that has to be answered, drawn as the mock-up's `.dlg` box over
 * its `.scrim`. Radix keeps focus inside, returns it, closes on Escape and
 * hides the page from screen readers; the markup inside is the mock-up's
 * (title as h3, the text as `.muted`, the buttons in `.acts`).
 */
export function Modal({
  open,
  onClose,
  title,
  text,
  buttons,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  text?: ReactNode;
  buttons: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="scrim" style={{ display: 'block' }} />
        <Dialog.Content
          className="dlg"
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 70,
            width: 'min(520px, calc(100% - 32px))',
            maxHeight: 'calc(100dvh - 32px)',
            overflowY: 'auto',
          }}
        >
          <Dialog.Title asChild>
            <h3>{title}</h3>
          </Dialog.Title>
          {text ? (
            <Dialog.Description asChild>
              <p className="muted">{text}</p>
            </Dialog.Description>
          ) : null}
          {children}
          <div className="acts">{buttons}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
