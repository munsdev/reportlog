/**
 * The public side of Plan E (session PE3): counts by where reports came from,
 * by place and by time; when reports arrived, by the hour, so a burst looks
 * like a burst; how many were declined and why; and every use of the flood
 * switches, with its time.
 *
 * COUNTS ONLY. Nothing here names a report or shows its words. Tables, not
 * charts: a table reads aloud, prints, and needs nothing from anywhere else.
 */
import { getDeclinedCounts, getPublicCounts, getSwitchLog } from '@reportlog/contracts';
import type { LogbookCounts } from '@reportlog/contracts';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Alert } from '../../components/ui/alert.tsx';
import { Page } from '../../components/ui/page.tsx';
import { call } from '../../lib/api.ts';

export const publicCountsQuery = queryOptions({
  queryKey: ['board', 'counts'],
  queryFn: ({ signal }) => call(getPublicCounts, { signal }),
});
export const declinedQuery = queryOptions({
  queryKey: ['board', 'declined'],
  queryFn: ({ signal }) => call(getDeclinedCounts, { signal }),
});
export const switchLogQuery = queryOptions({
  queryKey: ['board', 'switches'],
  queryFn: ({ signal }) => call(getSwitchLog, { signal }),
});

const hourWords = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function OriginTable({
  caption,
  first,
  rows,
  labels,
}: {
  caption: string;
  first: string;
  rows: { key: string; name: string; organization: number; open_form: number }[];
  labels: { organization: string; open_form: string };
}) {
  return (
    <table className="w-full border-collapse text-sm">
      <caption className="text-left font-semibold">{caption}</caption>
      <thead>
        <tr className="border-b border-line text-left">
          <th scope="col" className="py-1 pr-4">
            {first}
          </th>
          <th scope="col" className="py-1 pr-4 text-right">
            {labels.organization}
          </th>
          <th scope="col" className="py-1 text-right">
            {labels.open_form}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-b border-line">
            <th scope="row" className="py-1 pr-4 text-left font-normal">
              {r.name}
            </th>
            <td className="py-1 pr-4 text-right font-mono">{r.organization}</td>
            <td className="py-1 text-right font-mono">{r.open_form}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A counts-only logbook on the board: what it publishes instead of entries. */
export function CountsOnlyPanel({ slug, title }: { slug: string; title: string }) {
  const query = useQuery(publicCountsQuery);
  if (query.isPending) return <p role="status">Counting…</p>;
  if (query.isError) return <Alert tone="serious">{query.error.message}</Alert>;
  if (!query.data.published) return <Alert>{query.data.reason}</Alert>;
  const lb = query.data.logbooks.find((l) => l.slug === slug);
  if (!lb) return <Alert>There is nothing counted in this logbook yet.</Alert>;
  return (
    <section aria-label={`${title}, as counts`} className="flex flex-col gap-4">
      <Alert title="Published as counts only">
        This logbook’s accepted reports are published as counts by place and time, not one by one.
        {` ${query.data.note}`}
      </Alert>
      <LogbookTables lb={lb} labels={query.data.labels} />
    </section>
  );
}

function LogbookTables({
  lb,
  labels,
}: {
  lb: LogbookCounts;
  labels: { organization: string; open_form: string };
}) {
  return (
    <div className="flex flex-col gap-4">
      <OriginTable
        caption="Accepted reports"
        first="All"
        rows={[{ key: 'all', name: 'Accepted', ...lb.published }]}
        labels={labels}
      />
      {lb.by_place.length ? (
        <OriginTable
          caption="By place"
          first="Place"
          rows={lb.by_place.map((p) => ({ key: p.place, name: p.label, ...p }))}
          labels={labels}
        />
      ) : null}
      {lb.withheld_places ? (
        <p className="text-sm text-ink-alt">
          {`Fewer than ${String(lb.withheld_places.threshold)} accepted reports each, so these places are named without a number: ${lb.withheld_places.areas.join(', ')}`}
          {lb.withheld_places.reports !== null
            ? ` (${String(lb.withheld_places.reports)} together).`
            : '.'}
        </p>
      ) : null}
      {lb.by_day.length ? (
        <OriginTable
          caption="By the day they arrived (UTC)"
          first="Day"
          rows={lb.by_day.map((d) => ({ key: d.day, name: d.day, ...d }))}
          labels={labels}
        />
      ) : null}
      {lb.by_hour.length ? (
        <OriginTable
          caption="By the hour they arrived, the last two weeks"
          first="Hour"
          rows={lb.by_hour.map((d) => ({ key: d.hour, name: hourWords(d.hour), ...d }))}
          labels={labels}
        />
      ) : null}
    </div>
  );
}

/**
 * Its own page, beside "By the numbers": arrivals by hour, declines by
 * reason, and the switch log. Apart from the numbers on purpose: those count
 * published reports only (decision 36), and a declined count beside them
 * would read as part of the same total.
 */
export function ActivityPage() {
  const counts = useQuery(publicCountsQuery).data;
  const declined = useQuery(declinedQuery).data;
  return (
    <Page
      title="Arrivals, declines and switches"
      lede="When accepted reports arrived, by the hour, so a burst looks like a burst; how many reports were declined and why; and every time a moderator used a flood switch."
      width="prose"
    >
      <Link to="/board" className="underline">
        Back to the board
      </Link>
      {counts && !counts.published ? <Alert>{counts.reason}</Alert> : null}
      {counts?.published ? (
        <>
          <p className="text-sm">{counts.note}</p>
          {counts.logbooks.map((lb) =>
            lb.by_hour.length ? (
              <OriginTable
                key={lb.slug}
                caption={`${lb.title}: accepted reports by the hour they arrived`}
                first="Hour"
                rows={lb.by_hour.map((d) => ({ key: d.hour, name: hourWords(d.hour), ...d }))}
                labels={counts.labels}
              />
            ) : null,
          )}
        </>
      ) : null}
      {declined?.published ? (
        <>
          <p className="text-sm">{declined.note}</p>
          {declined.logbooks.map((lb) => (
            <div key={lb.slug}>
              <h3 className="font-semibold">{`${lb.title}: declined, by reason`}</h3>
              {lb.by_reason.length ? (
                <dl className="grid grid-cols-[1fr_auto] gap-x-6 text-sm">
                  {lb.by_reason.map((r) => (
                    <div key={r.code} className="contents">
                      <dt>{r.label}</dt>
                      <dd className="text-right font-mono">{r.reports}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm">None declined.</p>
              )}
            </div>
          ))}
        </>
      ) : null}
      <SwitchLog />
    </Page>
  );
}

const SWITCH_WORDS: Record<string, Record<string, string>> = {
  pause_intake: { on: 'Intake paused', off: 'Intake resumed' },
  puzzle: { harder: 'The puzzle made harder', normal: 'The puzzle put back to normal' },
  counts_only: { on: 'Published as counts only', off: 'Published as entries again' },
};

export function switchWords(u: { switch: string; value: string; subject: string | null }) {
  // Its value is the new threshold itself (Plan E, PE4).
  const what =
    u.switch === 'small_area'
      ? `Places with fewer than ${u.value} accepted reports counted without a number`
      : (SWITCH_WORDS[u.switch]?.[u.value] ?? `${u.switch}: ${u.value}`);
  return u.subject ? `${what}: ${u.subject}` : what;
}

/** Every switch use, with its time. Public, and never who. */
export function SwitchLog() {
  const log = useQuery(switchLogQuery).data;
  if (!log) return null;
  return (
    <div>
      <h3 className="font-semibold">The flood switches, every time they were used</h3>
      {log.uses.length ? (
        <ul className="text-sm">
          {log.uses.map((u, i) => (
            <li key={`${u.at}-${String(i)}`}>
              <time dateTime={u.at}>{hourWords(u.at)}</time> · {switchWords(u)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm">None has been used.</p>
      )}
    </div>
  );
}
