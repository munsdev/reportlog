import type { CSSProperties, ReactNode } from 'react';

type Cols = CSSProperties & { '--cols'?: string };

/**
 * The mock-up's `.rows.tbl` table (staff.py `table`): a head row, then rows
 * whose cells carry `data-l` so a phone can label them. `widths` is the
 * mock-up's `--cols` value.
 *
 * Drawn as a grid of boxes, so the ARIA table roles say what it is: without
 * them a screen reader read every cell as loose text, with no row or column.
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
    <div className="rows tbl" role="table">
      <div className="row head" style={style} role="row">
        {cols.map((c, i) => (
          <span key={i} role="columnheader">
            {c}
          </span>
        ))}
      </div>
      {rows.map((r) => (
        <div className="row" style={style} key={r.key} role="row">
          {r.cells.map((c, i) => (
            <span key={i} data-l={cols[i] ?? ''} role="cell">
              {c}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
