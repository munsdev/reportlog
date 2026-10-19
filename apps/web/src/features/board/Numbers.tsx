/**
 * By the numbers. Every count already broken out, and the denominator shown:
 * the reports that were declined, are still under review, or were withdrawn
 * are counted beside the published ones. There is no headline figure on
 * purpose: a bare "N incidents" is the number that gets quoted without the
 * caveat that these are reviewed accounts, not verified facts.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Alert } from '../../components/ui/alert.tsx';
import { Page } from '../../components/ui/page.tsx';
import { boardStatsQuery } from './queries.ts';

const DISPOSITIONS = [
  ['published', 'Published'],
  ['not_permitted', 'Approved, but its reporter did not permit publishing'],
  ['under_review', 'Under review'],
  ['declined', 'Declined'],
  ['unclear', 'Unclear'],
  ['withdrawn', 'Withdrawn'],
] as const;

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
          <section aria-labelledby="every" className="flex flex-col gap-2">
            <h2 id="every" className="font-display text-xl font-bold">
              Every confirmed report
            </h2>
            <p className="text-sm text-ink-alt">
              Including the ones never published. This is the denominator: the approval rate can be
              checked from it.
            </p>
            <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1">
              {DISPOSITIONS.map(([k, label]) => (
                <div key={k} className="contents">
                  <dt>{label}</dt>
                  <dd className="text-right font-mono">{d.confirmed_reports.by_disposition[k]}</dd>
                </div>
              ))}
            </dl>
            <p className="text-sm text-ink-alt">{d.confirmed_reports.excludes}</p>
          </section>
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
                    {q.unanswered ? (
                      <div className="contents">
                        <dt>Not answered</dt>
                        <dd className="text-right font-mono">{q.unanswered}</dd>
                      </div>
                    ) : null}
                  </dl>
                </div>
              ))}
            </section>
          ))}
          <p className="text-sm text-ink-alt">As of {new Date(d.as_of).toLocaleString()}.</p>
        </>
      ) : null}
    </Page>
  );
}
