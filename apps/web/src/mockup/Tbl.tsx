import type { CSSProperties, ReactNode } from 'react';

type Cols = CSSProperties & { '--cols'?: string };

/**
 * The mock-up's `.rows.tbl` table (staff.py `table`): a head row, then rows
 * whose cells carry `data-l` so a phone can label them. `widths` is the
 * mock-up's `--cols` value.
 */
export function Tbl({
  cols,
  rows,
  widths,
}: {
  cols: string[];
  rows: { key: string | number; cells: ReactNode[] }[];
  widths?: string;
}) {
  const style: Cols | undefined = widths ? { '--cols': widths } : undefined;
  return (
    <div className="rows tbl">
      <div className="row head" style={style}>
        {cols.map((c, i) => (
          <span key={i}>{c}</span>
        ))}
      </div>
      {rows.map((r) => (
        <div className="row" style={style} key={r.key}>
          {r.cells.map((c, i) => (
            <span key={i} data-l={cols[i] ?? ''}>
              {c}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
