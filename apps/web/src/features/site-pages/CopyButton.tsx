/**
 * "Copy", as a quiet button beside something worth copying: an address, a
 * fingerprint. Says "Copied" once it has, in a status a screen reader
 * hears. If the browser refuses (an insecure page, a locked-down browser),
 * nothing changes: the text is on screen to select by hand.
 */
import { useState } from 'react';
import { Btn } from '@/mockup/Btn.tsx';
import { cn } from '@/lib/utils.ts';

export function CopyButton({
  text,
  what,
  className,
}: {
  text: string;
  /** What is copied, for the button's name: "Copy the fingerprint". */
  what: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <Btn
        type="button"
        look="ghost"
        className="-ml-2 font-sans"
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
        Copy
      </Btn>
      <span role="status" className="text-sm text-ink-alt">
        {copied ? 'Copied' : ''}
      </span>
    </span>
  );
}
