/**
 * By the numbers. Every count already broken out, and only published
 * reports are counted (owner decision 36). There is no headline figure on
 * purpose: a bare "N incidents" is the number that gets quoted without the
 * caveat that these are reviewed accounts, not verified facts.
 */
import { useQuery } from '@tanstack/react-query';
import { Alert } from '../../components/ui/alert.tsx';
import { NotASample } from '../../components/ui/not-a-sample.tsx';
import { Card } from '../../components/ui/card.tsx';
import { Bars } from '../../components/ui/bars.tsx';
import { Meta } from '../../components/ui/type.tsx';
import { BoardFrame } from './BoardFrame.tsx';
import { MapSlot } from '../maps/MapSlot.tsx';
import { boardStatsQuery } from './queries.ts';

export function NumbersPage() {
  const query = useQuery(boardStatsQuery);
  const d = query.data?.published ? query.data : null;
  return (
    <BoardFrame title="By the numbers" heading="By the numbers">
      {query.isPending ? <p role="status">Counting…</p> : null}
      {query.isError ? (
        <Alert tone="serious" title="The numbers could not be loaded">
          {query.error.message}
        </Alert>
      ) : null}
      {query.data && !query.data.published ? <Alert>{query.data.reason}</Alert> : null}
      {d ? (
        <>
          <NotASample line={d.not_a_sample} />
          <Alert>{d.note}</Alert>
          {Object.entries(d.published_reports.by_logbook).map(([slug, b]) => (
            <section key={slug} aria-labelledby={`lb-${slug}`} className="flex flex-col gap-4">
              <h2 id={`lb-${slug}`} className="font-display text-section">
                {b.title}
              </h2>
              <p>
                Published reports: <Meta className="text-base text-ink">{b.published}</Meta>
              </p>
              {Object.entries(b.by_question).map(([key, q]) => (
                <Card key={key} heading={q.label} headingLevel={3}>
                  <Bars
                    label={q.label}
                    items={[
                      ...Object.entries(q.counts)
                        .sort((x, y) => y[1] - x[1])
                        .map(([answer, n]) => ({ label: answer, value: n })),
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
                    <p className="max-w-prose text-sm text-ink-alt">
                      Fewer than {q.withheld.threshold} published reports each, so these places are
                      named without a number: {q.withheld.areas.join(', ')}.
                    </p>
                  ) : null}
                </Card>
              ))}
            </section>
          ))}
          <MapSlot slot="board_numbers" />
        </>
      ) : null}
    </BoardFrame>
  );
}
