import type { ReactNode } from 'react';

/**
 * The mock-up's `.pager`. Where the list pages in place (`onPage`): the page
 * you are on, its neighbours and Previous / Next, as buttons. Where each page
 * has an address (`link`, which draws one link to a page): the page you are
 * on, its neighbours, first and last, and Next. Draws nothing for one page.
 */
export function Pager({
  page,
  pages,
  onPage,
  link,
  label = 'Pages',
}: {
  /** 1-based. */
  page: number;
  pages: number;
  onPage?: (page: number) => void;
  link?: (page: number, children: ReactNode, ariaLabel?: string) => ReactNode;
  label?: string;
}) {
  if (pages <= 1) return null;
  if (link) {
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
  const go = (n: number) => () => {
    onPage?.(n);
  };
  const near = [page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages);
  return (
    <nav className="pager print:hidden" aria-label={label}>
      {page > 1 ? (
        <button
          type="button"
          onClick={go(page - 1)}
        >
          Previous
        </button>
      ) : null}
      {near[0] !== undefined && near[0] > 1 ? <span aria-hidden="true">…</span> : null}
      {near.map((p) =>
        p === page ? (
          <span key={p} aria-current="page">
            {p}
          </span>
        ) : (
          <button
            key={p}
            type="button"
            aria-label={`Page ${String(p)}`}
            onClick={go(p)}
          >
            {p}
          </button>
        ),
      )}
      {near[near.length - 1] !== undefined && (near[near.length - 1] ?? 0) < pages ? (
        <span aria-hidden="true">…</span>
      ) : null}
      {page < pages ? (
        <button
          type="button"
          onClick={go(page + 1)}
        >
          Next
        </button>
      ) : null}
    </nav>
  );
}
