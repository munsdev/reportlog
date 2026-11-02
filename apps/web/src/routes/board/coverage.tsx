import { createFileRoute } from '@tanstack/react-router';
import { BoardCoverage, type CoverageSearch } from '../../features/articles/BoardCoverage.tsx';

/** The address carries the place clicked and the page, so a narrowed list can be shared. */
export const Route = createFileRoute('/board/coverage')({
  validateSearch: (s: Record<string, unknown>): CoverageSearch => {
    const out: CoverageSearch = {};
    const place = typeof s.place === 'string' ? s.place.slice(0, 12) : '';
    if (/^[A-Z]{2}(-[A-Z0-9]{1,3})?(-\d{5})?$/.test(place)) out.place = place;
    const page = Number(s.page);
    if (Number.isInteger(page) && page > 1 && page <= 10000) out.page = page;
    return out;
  },
  component: function Coverage() {
    return <BoardCoverage search={Route.useSearch()} />;
  },
});
