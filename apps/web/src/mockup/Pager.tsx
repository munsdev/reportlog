/** The mock-up's `.pager`: numbered pages, the current one marked. Nothing when there is one page. */
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
  return (
    <nav className="pager" aria-label={label}>
      {Array.from({ length: pages }, (_, i) => i + 1).map((n) =>
        n === page ? (
          <span key={n} aria-current="page">
            {n}
          </span>
        ) : (
          // eslint-disable-next-line jsx-a11y/anchor-is-valid
          <a
            key={n}
            href="#"
            onClick={(e) => {
              e.preventDefault();
              onPage(n);
            }}
          >
            {n}
          </a>
        ),
      )}
    </nav>
  );
}
