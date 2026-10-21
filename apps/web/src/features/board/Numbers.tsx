/**
 * By the numbers. Every count already broken out, and only published
 * reports are counted (owner decision 36). There is no headline figure on
 * purpose: a bare "N incidents" is the number that gets quoted without the
 * caveat that these are reviewed accounts, not verified facts.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Alert } from '../../components/ui/alert.tsx';
import { NotASample } from '../../components/ui/not-a-sample.tsx';
import { Page } from '../../components/ui/page.tsx';
import { MapSlot } from '../maps/MapSlot.tsx';
import { boardStatsQuery } from './queries.ts';

export function NumbersPage() {
  const query = useQuery(boardStatsQuery);
  const d = query.data?.published ? query.data : null;
  return (
    <Page title="By the numbers" width="prose">
      <Link to="/board" className="underline">
        Back to the board
      </Link>
      {query.isPending ? <p role="status">Counting…</p> : null}
      {query.isError ? <Alert tone="serious">{query.error.message}</Alert> : null}
      {query.data && !query.data.published ? <Alert>{query.data.reason}</Alert> : null}
      {d ? (
        <>
          <Alert>{d.note}</Alert>
          <NotASample line={d.not_a_sample} />
          {Object.entries(d.published_reports.by_logbook).map(([slug, b]) => (
            <section key={slug} aria-labelledby={`lb-${slug}`} className="flex flex-col gap-2">
              <h2 id={`lb-${slug}`} className="font-display text-xl font-bold">
                {b.title}
              </h2>
              <p>
                Published reports: <span className="font-mono">{b.published}</span>
              </p>
              {Object.entries(b.by_question).map(([key, q]) => (
                <div key={key}>
                  <h3 className="font-semibold">{q.label}</h3>
                  <dl className="grid grid-cols-[1fr_auto] gap-x-6">
                    {Object.entries(q.counts)
                      .sort((x, y) => y[1] - x[1])
                      .map(([answer, n]) => (
                        <div key={answer} className="contents">
                          <dt>{answer}</dt>
                          <dd className="text-right font-mono">{n}</dd>
                        </div>
                      ))}
                    {q.withheld && q.withheld.reports !== null ? (
                      <div className="contents">
                        <dt>Places with fewer than {q.withheld.threshold}, together</dt>
                        <dd className="text-right font-mono">{q.withheld.reports}</dd>
                      </div>
                    ) : null}
                    {q.unanswered ? (
                      <div className="contents">
                        <dt>Not answered</dt>
                        <dd className="text-right font-mono">{q.unanswered}</dd>
                      </div>
                    ) : null}
                  </dl>
                  {q.withheld ? (
                    <p className="text-sm text-ink-alt">
                      Fewer than {q.withheld.threshold} published reports each, so these places are
                      named without a number: {q.withheld.areas.join(', ')}.
                    </p>
                  ) : null}
                </div>
              ))}
            </section>
          ))}
          <MapSlot slot="board_numbers" />
          <p className="text-sm text-ink-alt">As of {new Date(d.as_of).toLocaleString()}.</p>
        </>
      ) : null}
    </Page>
  );
}
