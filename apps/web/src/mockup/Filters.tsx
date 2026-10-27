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
        <a
          key={o.value}
          href="#"
          {...(o.value === value ? { 'aria-current': 'true' as const } : {})}
          onClick={(e) => {
            e.preventDefault();
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
        </a>
      ))}
    </div>
  );
}
