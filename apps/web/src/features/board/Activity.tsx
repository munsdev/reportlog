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
import { call } from '../../lib/api.ts';
import { Note } from '../../mockup/Note.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { Tbl } from '../../mockup/Tbl.tsx';
import { BoardFrame } from './BoardFrame.tsx';

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
    <Panel title={caption}>
      <Tbl
        cols={[first, labels.organization, labels.open_form]}
        widths="1fr auto auto"
        rows={rows.map((r) => ({
          key: r.key,
          cells: [r.name, r.organization, r.open_form],
        }))}
      />
    </Panel>
  );
}

/** A counts-only logbook on the board: what it publishes instead of entries. */
export function CountsOnlyPanel({ slug, title }: { slug: string; title: string }) {
  const query = useQuery(publicCountsQuery);
  if (query.isPending) return <p role="status">Counting…</p>;
  if (query.isError)
    return (
      <Note warn>
        <span role="alert">{query.error.message}</span>
      </Note>
    );
  if (!query.data.published)
    return (
      <Note>
        <span>{query.data.reason}</span>
      </Note>
    );
  const lb = query.data.logbooks.find((l) => l.slug === slug);
  if (!lb)
    return (
      <Note>
        <span>There is nothing counted in this logbook yet.</span>
      </Note>
    );
  return (
    <section
      aria-label={`${title}, as counts`}
      style={{ display: 'grid', gap: 22, paddingBlock: 18 }}
    >
      <Note>
        <span>
          <b>Published as counts only.</b> This logbook’s accepted reports are published as counts
          by place and time, not one by one.
          {` ${query.data.note}`}
        </span>
      </Note>
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
    <>
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
        <p className="muted">
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
    </>
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
    <BoardFrame
      title="Arrivals, declines and switches"
      lede="When accepted reports arrived, by the hour, so a burst looks like a burst; how many reports were declined and why; and every time a moderator used a flood switch."
    >
      {counts && !counts.published ? (
        <Note>
          <span>{counts.reason}</span>
        </Note>
      ) : null}
      {counts?.published ? (
        <>
          <p className="muted">{counts.note}</p>
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
          <p className="muted">{declined.note}</p>
          {declined.logbooks.map((lb) => (
            <Panel key={lb.slug} title={`${lb.title}: declined, by reason`}>
              {lb.by_reason.length ? (
                <Tbl
                  cols={['Reason', 'Count']}
                  widths="1fr auto"
                  rows={lb.by_reason.map((r) => ({ key: r.code, cells: [r.label, r.reports] }))}
                />
              ) : (
                <p className="muted">None declined.</p>
              )}
            </Panel>
          ))}
        </>
      ) : null}
      <SwitchLog />
    </BoardFrame>
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
    <Panel title="The flood switches, every time they were used">
      {log.uses.length ? (
        <Tbl
          cols={['When', 'What']}
          widths="auto 1fr"
          rows={log.uses.map((u, i) => ({
            key: `${u.at}-${String(i)}`,
            cells: [<time dateTime={u.at}>{hourWords(u.at)}</time>, switchWords(u)],
          }))}
        />
      ) : (
        <p className="muted">None has been used.</p>
      )}
    </Panel>
  );
}
