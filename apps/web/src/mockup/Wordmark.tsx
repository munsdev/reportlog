import { Fragment } from 'react';
import type { BrandPart } from '@reportlog/contracts';

/**
 * The mock-up's wordmark: `<span class="wm">Election<b>Log</b><i>.org</i></span>`.
 * The site's name arrives split into parts by the operator's own marks
 * (`"…"` is the accent, `'…'` the muted ending); the name is never typed here.
 */
export function Wordmark({
  parts,
  label,
  as: Tag = 'span',
}: {
  parts: readonly BrandPart[];
  label: string;
  as?: 'span' | 'p';
}) {
  return (
    <Tag className="wm" aria-label={label}>
      {parts.map((p, i) =>
        p.mark === 'a' ? (
          <b key={i}>{p.text}</b>
        ) : p.mark === 'b' ? (
          <i key={i}>{p.text}</i>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </Tag>
  );
}
