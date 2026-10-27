import type { ReactNode } from 'react';

/** The mock-up's `.seg-filter` row of choices, each with an optional count. */
export function Filters<T extends string>({
  options,
  value,
  onChange,
  label = 'Show',
}: {
  options: { value: T; label: ReactNode; n?: number | undefined }[];
  value: T;
  onChange: (next: T) => void;
  label?: string;
}) {
  return (
    <div className="seg-filter" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => {
            onChange(o.value);
          }}
        >
          {o.label}
          {o.n !== undefined ? (
            <>
              {' '}
              <span className="n">{o.n}</span>
            </>
          ) : null}
        </button>
      ))}
    </div>
  );
}
