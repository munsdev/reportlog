/**
 * By the numbers (mock-up board-numbers.html). Every count already broken
 * out, and only published reports are counted (owner decision 36). There is
 * no headline figure on purpose: a bare "N incidents" is the number that
 * gets quoted without the caveat that these are reviewed accounts, not
 * verified facts.
 */
import { useQuery } from '@tanstack/react-query';
import { NotASample } from '../../components/ui/not-a-sample.tsx';
import { Bars } from '../../mockup/Bars.tsx';
import { Note } from '../../mockup/Note.tsx';
import { SecHead } from '../../mockup/SecHead.tsx';
import { MapSlot } from '../maps/MapSlot.tsx';
import { BoardFrame } from './BoardFrame.tsx';
import { boardStatsQuery } from './queries.ts';

export function NumbersPage() {
  const query = useQuery(boardStatsQuery);
  const d = query.data?.published ? query.data : null;
  let n = 0;
  return (
    <BoardFrame title="By the numbers">
      {query.isPending ? <p role="status">Counting…</p> : null}
      {query.isError ? (
        <Note warn>
          <span role="alert">
            <b>The numbers could not be loaded.</b> {query.error.message}
          </span>
        </Note>
      ) : null}
      {query.data && !query.data.published ? (
        <Note>
          <span>{query.data.reason}</span>
        </Note>
      ) : null}
      {d ? (
        <>
          <NotASample line={d.not_a_sample} />
          <Note>
            <span>{d.note}</span>
          </Note>
          {Object.entries(d.published_reports.by_logbook).flatMap(([slug, b]) =>
            Object.entries(b.by_question).map(([key, q]) => {
              n += 1;
              const id = `n-${slug}-${key}`;
              return (
                <section key={id} className="section" aria-labelledby={id}>
                  <SecHead num={String(n).padStart(2, '0')} id={id} title={q.label}>
                    {`${b.title}. Published reports: ${b.published.toLocaleString('en-US')}.`}
                  </SecHead>
                  <Bars
                    label={q.label}
                    items={[
                      ...Object.entries(q.counts)
                        .sort((x, y) => y[1] - x[1])
                        .map(([answer, c]) => ({ label: answer, value: c })),
                      ...(q.withheld && q.withheld.reports !== null
                        ? [
                            {
                              label: `Places with fewer than ${String(q.withheld.threshold)}, together`,
                              value: q.withheld.reports,
                            },
                          ]
                        : []),
                      // Last, always: an unanswered question is counted, not hidden.
                      ...(q.unanswered ? [{ label: 'Not answered', value: q.unanswered }] : []),
                    ]}
                  />
                  {q.withheld ? (
                    <p className="muted" style={{ paddingTop: 10, fontSize: '.9rem' }}>
                      Fewer than {q.withheld.threshold} published reports each, so these places are
                      named without a number: {q.withheld.areas.join(', ')}.
                    </p>
                  ) : null}
                </section>
              );
            }),
          )}
          <MapSlot slot="board_numbers" />
        </>
      ) : null}
    </BoardFrame>
  );
}
