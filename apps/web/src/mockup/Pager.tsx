/**
 * The mock-up's `.pager`: the page you are on, its neighbours and Previous /
 * Next, for a list that pages in place. Draws nothing for one page.
 */
export function Pager({
  page,
  pages,
  onPage,
  label = 'Pages',
}: {
  /** 1-based. */
  page: number;
  pages: number;
  onPage: (page: number) => void;
  label?: string;
}) {
  if (pages <= 1) return null;
  const near = [page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages);
  return (
    <nav className="pager print:hidden" aria-label={label}>
      {page > 1 ? (
        <button
          type="button"
          onClick={() => {
            onPage(page - 1);
          }}
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
            onClick={() => {
              onPage(p);
            }}
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
          onClick={() => {
            onPage(page + 1);
          }}
        >
          Next
        </button>
      ) : null}
    </nav>
  );
}
