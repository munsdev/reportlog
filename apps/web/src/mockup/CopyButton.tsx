import { useState } from 'react';

/**
 * "Copy" as the mock-up's small flat button, with a status a screen reader
 * hears once it has. Copying is done here, not by site.js: its `[data-copy]`
 * handlers are bound once at load, so a button drawn later by React never
 * gets one. If the browser refuses (an insecure page), nothing changes: the
 * text is on screen to select by hand.
 */
export function CopyButton({
  text,
  what,
  label = 'Copy',
}: {
  text: string;
  /** For the button's name: "Copy the fingerprint". */
  what: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
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
  );
}
