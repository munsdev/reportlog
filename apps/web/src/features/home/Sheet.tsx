/**
 * The editor's side sheet (`.sheet` over `.scrim`): a dialog that holds a
 * block's fields. Escape and the scrim close it, focus goes to its first
 * field and comes back to where it was, and Tab stays inside while it is open.
 */
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

const FOCUSABLE = 'input,select,textarea,button:not([disabled]),a[href]';

export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const closing = useRef(onClose);
  useEffect(() => {
    closing.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const was = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = sheet.current?.querySelector<HTMLElement>(
      '.field input, .field select, .field textarea, .choice input',
    );
    (first ?? sheet.current?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closing.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const all = [...(sheet.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      const a = all[0];
      const z = all.at(-1);
      if (!a || !z) return;
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      was?.focus();
    };
  }, []);

  return (
    <>
      {/* A click outside closes it; the keyboard's way is Escape (above). */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className="scrim" {...{ open: true }} onClick={onClose} />
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        ref={sheet}
        {...{ open: true }}
      >
        <div className="in">
          <div className="sheet-head">
            <h2 id="sheet-title">{title}</h2>
            <button className="tb" type="button" onClick={onClose}>
              Close
            </button>
          </div>
          {children}
        </div>
      </div>
    </>
  );
}
