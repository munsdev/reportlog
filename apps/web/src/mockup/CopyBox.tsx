import type { ReactNode } from 'react';
import { CopyButton } from './CopyButton.tsx';

/**
 * `<div class="copybox">`: a line of text or a code value and a Copy button
 * (see CopyButton for why the copying is done in React).
 */
export function CopyBox({
  text,
  what,
  code,
  label,
  children,
}: {
  /** What goes on the clipboard. */
  text: string;
  /** For the button's name: "Copy the address". */
  what: string;
  /** Beside the button, when it is not the whole text. */
  code?: ReactNode;
  label?: string;
  /** A paragraph above the row (a ready-made post). */
  children?: ReactNode;
}) {
  return (
    <div className="copybox">
      {children ? <p>{children}</p> : null}
      <div className="row">
        <code>{code ?? text}</code>
        <CopyButton text={text} what={what} {...(label ? { label } : {})} />
      </div>
    </div>
  );
}
