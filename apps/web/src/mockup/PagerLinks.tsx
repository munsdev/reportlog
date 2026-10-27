import type { ReactNode } from 'react';

/**
 * The mock-up's `.pager` for a list whose pages have addresses: the page you
 * are on, its neighbours, first and last, and Next. `link` draws one link to
 * a page (the caller knows the address). Draws nothing for one page.
 */
export function PagerLinks({
  page,
  pages,
  link,
  label = 'Pages',
}: {
  /** 1-based. */
  page: number;
  pages: number;
  link: (page: number, children: ReactNode, ariaLabel?: string) => ReactNode;
  label?: string;
}) {
  if (pages <= 1) return null;
  const shown = [...new Set([1, page - 1, page, page + 1, pages])]
    .filter((p) => p >= 1 && p <= pages)
    .sort((a, b) => a - b);
  return (
    <nav className="pager print:hidden" aria-label={label}>
      {shown.map((p, i) => {
        const gap = i > 0 && p - (shown[i - 1] ?? p) > 1;
        return (
          <span key={p} style={{ display: 'contents' }}>
            {gap ? <span aria-hidden="true">…</span> : null}
            {p === page ? <span aria-current="page">{p}</span> : link(p, p, `Page ${String(p)}`)}
          </span>
        );
      })}
      {page < pages ? link(page + 1, 'Next') : null}
    </nav>
  );
}
