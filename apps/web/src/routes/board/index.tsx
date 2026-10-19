import { createFileRoute } from '@tanstack/react-router';
import { BoardPage } from '../../features/board/Board.tsx';
import type { BoardSearch } from '../../features/board/queries.ts';

const text = (v: unknown, max = 200) => (typeof v === 'string' && v ? v.slice(0, max) : undefined);

/** The board's address carries its filters, so a narrowed board can be shared. */
export const Route = createFileRoute('/board/')({
  validateSearch: (s: Record<string, unknown>): BoardSearch => {
    const out: BoardSearch = {};
    const q = text(s.q);
    if (q) out.q = q;
    const logbook = text(s.logbook, 63);
    if (logbook) out.logbook = logbook;
    const page = Number(s.page);
    if (Number.isInteger(page) && page > 1) out.page = page;
    if (s.f && typeof s.f === 'object') {
      const f: Record<string, string> = {};
      for (const [k, v] of Object.entries(s.f)) {
        const value = text(v);
        if (/^[a-z0-9][a-z0-9_]{0,38}$/.test(k) && value) f[k] = value;
      }
      if (Object.keys(f).length) out.f = f;
    }
    return out;
  },
  component: function Board() {
    return <BoardPage search={Route.useSearch()} />;
  },
});
