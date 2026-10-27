import { useState } from 'react';
import type { ReactNode } from 'react';
import { Btn } from './Btn.tsx';

/**
 * The mock-up's copy button (`.btn.sm.flat`, `data-copy`): copies `text`,
 * says "Copied" in the page's toast when the page has one, and in a status a
 * screen reader hears. If the browser refuses, nothing changes: the text is
 * on screen to select by hand.
 */
export function CopyBtn({
  text,
  children,
  label,
}: {
  text: string;
  children: ReactNode;
  /** A name for the button when its words alone do not say what is copied. */
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <Btn
        sm
        flat
        style={{ justifySelf: 'start' }}
        aria-label={label}
        onClick={() => {
          void navigator.clipboard.writeText(text).then(
            () => {
              setCopied(true);
              (window as unknown as { elSay?: (m: string) => void }).elSay?.('Copied');
            },
            () => {
              setCopied(false);
            },
          );
        }}
      >
        {children}
      </Btn>
      <span role="status" className="sr-only">
        {copied ? 'Copied' : ''}
      </span>
    </>
  );
}
