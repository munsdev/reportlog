import { useState } from 'react';
import type { ReactNode } from 'react';

/**
 * `<div class="copybox">`: a line of text or a code value and a Copy button
 * (`btn sm flat`).
 *
 * The copying is done here, not by site.js: its `[data-copy]` handlers are
 * bound once at load, so a button drawn later by React never gets one, and
 * the app already uses `data-copy` as a marker for the operator's wording.
 * If the browser refuses (an insecure page), nothing changes: the text is on
 * screen to select by hand.
 */
export function CopyBox({
  text,
  what,
  code,
  label = 'Copy',
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
  const [copied, setCopied] = useState(false);
  return (
    <div className="copybox">
      {children ? <p>{children}</p> : null}
      <div className="row">
        <code>{code ?? text}</code>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span role="status" className="muted">
            {copied ? 'Copied' : ''}
          </span>
          <button
            className="btn sm flat"
            type="button"
            aria-label={`Copy ${what}`}
            onClick={() => {
              void navigator.clipboard.writeText(text).then(
                () => {
                  setCopied(true);
                },
                () => {
                  setCopied(false);
                },
              );
            }}
          >
            {label}
          </button>
        </span>
      </div>
    </div>
  );
}
