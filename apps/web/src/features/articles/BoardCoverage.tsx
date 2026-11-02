/**
 * The board's Coverage tab (decision 84): news articles journalists linked to
 * events, beside the same maps as the reports, opening on the coverage layer.
 * A place clicked on the map narrows the list to it and goes in the address,
 * as on the reports list (decision 82). Every article on it was approved by
 * a moderator and listed by its author.
 */
import type { PublicArticle } from '@reportlog/contracts';
import { placeLabel } from '@reportlog/fields';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Btn } from '@/mockup/Btn.tsx';
import { ErrorNote, Waiting } from '@/mockup/Note.tsx';
import { BoardFrame } from '../board/BoardFrame.tsx';
import { MapSlot } from '../maps/MapSlot.tsx';
import { placedMapsQuery } from '../maps/queries.ts';
import { LinkCard } from './LinkCard.tsx';
import { coverageListQuery } from './queries.ts';

export interface CoverageSearch {
  place?: string;
  page?: number;
}

export function BoardCoverage({ search }: { search: CoverageSearch }) {
  const navigate = useNavigate();
  const page = search.page ?? 1;
  const list = useQuery(coverageListQuery(search.place, page));
  const placed = useQuery(placedMapsQuery());
  const hasMap = (placed.data?.maps ?? []).some(
    (m) => m.slot === 'board_reports' || m.also_slots.includes('board_reports'),
  );
  const go = (next: CoverageSearch) => {
    void navigate({ to: '/board/coverage', search: next });
  };
  const choose = (code: string | null) => {
    if ((code ?? undefined) === search.place) return;
    go(code ? { place: code } : {});
  };
  return (
    <BoardFrame
      title="Coverage"
      list
      lede="News articles about events like the ones reported here, linked by journalists with access and approved by a moderator. They are the journalists’ work, not reports, and this site does not vouch for them."
    >
      <div className={hasMap ? 'grid gap-6 lg:grid-cols-3 lg:items-start' : undefined}>
        {hasMap ? (
          <div className="lg:col-span-2">
            <MapSlot
              slot="board_reports"
              startLayer="coverage"
              chosen={search.place ?? null}
              onChosen={choose}
            />
          </div>
        ) : null}
        <section className="grid gap-4" aria-label="Articles">
          {search.place ? (
            <p className="flex flex-wrap items-center gap-2">
              <span>
                In <b>{placeLabel(search.place)}</b>
              </span>
              <Link to="/board/coverage" search={{}}>
                Show everywhere
              </Link>
            </p>
          ) : null}
          {list.isPending ? (
            <Waiting>Loading the articles…</Waiting>
          ) : list.isError ? (
            <ErrorNote error={list.error} />
          ) : list.data.total === 0 ? (
            <p className="muted">
              {search.place ? 'No articles about this place yet.' : 'No articles yet.'}
            </p>
          ) : (
            <>
              <p className="m">
                {list.data.total} {list.data.total === 1 ? 'article' : 'articles'}
              </p>
              {list.data.articles.map((a: PublicArticle) => (
                <LinkCard key={a.id} article={a} />
              ))}
              {list.data.total > list.data.page * list.data.page_size || page > 1 ? (
                <div className="btn-row">
                  {page > 1 ? (
                    <Btn
                      sm
                      onClick={() => {
                        go({ ...search, page: page - 1 });
                      }}
                    >
                      Newer
                    </Btn>
                  ) : null}
                  {list.data.total > list.data.page * list.data.page_size ? (
                    <Btn
                      sm
                      onClick={() => {
                        go({ ...search, page: page + 1 });
                      }}
                    >
                      Older
                    </Btn>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </BoardFrame>
  );
}
