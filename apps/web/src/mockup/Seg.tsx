import type { ReactNode } from 'react';

export interface SegOption {
  key: string;
  label: ReactNode;
  /** A count in the mock-up's `.n` pill. */
  n?: number | undefined;
  /** The count said in full for a screen reader. */
  words?: string | undefined;
  pressed: boolean;
  onClick: () => void;
}

/**
 * The mock-up's `.seg-filter` row. Each choice is a button that is
 * `aria-pressed` while in force (a button, not the mock-up's `a href="#"`,
 * because it acts in place and does not go anywhere).
 */
export function Seg({ label, options }: { label: string; options: readonly SegOption[] }) {
  return (
    <div className="seg-filter" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.key} type="button" aria-pressed={o.pressed} onClick={o.onClick}>
          {o.label}
          {o.n !== undefined ? (
            <>
              <span className="n" aria-hidden="true">
                {o.n}
              </span>
              <span className="sr-only">, {o.words ?? String(o.n)}</span>
            </>
          ) : null}
        </button>
      ))}
    </div>
  );
}
