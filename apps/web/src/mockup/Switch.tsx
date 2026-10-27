import type { ReactNode } from 'react';

/** The mock-up's `.switch` row: a title, a line under it, and the toggle. */
export function Switch({
  title,
  sub,
  on,
  onChange,
  disabled,
}: {
  title: ReactNode;
  sub?: ReactNode;
  on: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const label = typeof title === 'string' ? title : undefined;
  return (
    <div className="switch">
      <div>
        <b>{title}</b>
        {sub ? <span>{sub}</span> : null}
      </div>
      <button
        className="tgl"
        role="switch"
        aria-checked={on}
        {...(label ? { 'aria-label': label } : {})}
        type="button"
        disabled={disabled}
        onClick={() => {
          onChange(!on);
        }}
      ></button>
    </div>
  );
}
