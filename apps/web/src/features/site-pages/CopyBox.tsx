/**
 * The mock-up's copy box: a bordered box holding a line of text (an address,
 * a ready-made post) and a Copy button. Text that wraps, never scrolls.
 */
import type { ReactNode } from 'react';
import { CopyButton } from './CopyButton.tsx';

export function CopyBox({
  text,
  what,
  children,
  code,
}: {
  /** What goes on the clipboard. */
  text: string;
  /** For the button's name: "Copy the address". */
  what: string;
  /** What the box shows above the row, when it is more than `code`. */
  children?: ReactNode;
  /** The short line beside the button. */
  code?: string;
}) {
  return (
    <div className="grid gap-2 rounded-card border-[1.5px] border-line bg-surface p-3.5">
      {children ? <p className="text-[0.95rem] text-ink-alt">{children}</p> : null}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2.5">
        <code className="min-w-0 font-mono text-[0.85rem] break-words text-ink [overflow-wrap:anywhere]">
          {code ?? text}
        </code>
        <CopyButton text={text} what={what} />
      </div>
    </div>
  );
}
