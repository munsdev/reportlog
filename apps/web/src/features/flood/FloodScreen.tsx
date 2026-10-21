/**
 * The flood screen (Plan E, PE3): everything a moderator needs during a
 * flood, without server access.
 *
 *   SEE IT COMING   submissions per hour for 24 hours, reports and tips;
 *                   refusals at the door per hour, by check, without content;
 *                   the answer sets several reports share.
 *   CLEAN UP        each identical set and each organization opens the queue
 *                   filtered to it, where it can be declined (or approved) as
 *                   a set; tip links are withheld by time window here.
 *   SWITCHES        pause intake, and the harder puzzle. Every use is
 *                   recorded with who and when, and shown publicly with its
 *                   time.
 *
 * Nothing here moves by itself: the numbers are read when the page opens and
 * when "Read again" is pressed. A table that refreshes under somebody who is
 * reading it is a table they misread.
 *
 * Pausing, the puzzle and the bulk declines ask for the second factor again
 * (step-up); the API client shows the prompt and retries (lib/api.ts).
 */
import {
  bulkDeclineLinks,
  getFloodScreen,
  getSwitches,
  listOrganizationLane,
  setIntakePause,
  setPuzzleLevel,
} from '@reportlog/contracts';
import type { ResponseOf } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Field } from '../../components/ui/field.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Page } from '../../components/ui/page.tsx';
import { call } from '../../lib/api.ts';
import { switchWords } from '../board/Activity.tsx';
import { intakePauseQuery } from './IntakePaused.tsx';

const floodQuery = queryOptions({
  queryKey: ['moderation', 'flood'],
  queryFn: ({ signal }) => call(getFloodScreen, { signal }),
  refetchOnWindowFocus: false,
});
const switchesQuery = queryOptions({
  queryKey: ['moderation', 'switches'],
  queryFn: ({ signal }) => call(getSwitches, { signal }),
  refetchOnWindowFocus: false,
});
const laneQuery = queryOptions({
  queryKey: ['moderation', 'lane'],
  queryFn: ({ signal }) => call(listOrganizationLane, { signal }),
  refetchOnWindowFocus: false,
});

const hour = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { timeStyle: 'short' });
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5"
    >
      <h2 id={id} className="font-display text-xl font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function FloodScreen() {
  const qc = useQueryClient();
  const flood = useQuery(floodQuery);
  return (
    <Page
      title="Flood screen"
      lede="What is arriving, what the door is refusing, and the controls for a flood. Every switch use is recorded with your name and shown publicly with its time."
      actions={
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void qc.invalidateQueries({ queryKey: ['moderation'] });
          }}
        >
          Read again
        </Button>
      }
    >
      <Switches />
      {flood.isPending ? <p role="status">Counting…</p> : null}
      {flood.isError ? <Alert tone="serious">{flood.error.message}</Alert> : null}
      {flood.data ? (
        <>
          <Totals totals={flood.data.totals} />
          <Section title="Submissions per hour, the last 24 hours">
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Reports and tips that arrived, by hour</caption>
              <thead>
                <tr className="border-b border-line text-left">
                  <th scope="col" className="py-1 pr-4">
                    Hour starting
                  </th>
                  <th scope="col" className="py-1 pr-4 text-right">
                    Reports
                  </th>
                  <th scope="col" className="py-1 text-right">
                    Tips and list entries
                  </th>
                </tr>
              </thead>
              <tbody>
                {flood.data.hours.map((h) => (
                  <tr key={h.hour} className="border-b border-line">
                    <th scope="row" className="py-1 pr-4 text-left font-normal">
                      {hour(h.hour)}
                    </th>
                    <td className="py-1 pr-4 text-right font-mono">{h.reports}</td>
                    <td className="py-1 text-right font-mono">{h.tips}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
          <Section title="Refused at the door, per hour, by check">
            <p className="text-sm text-ink-alt">
              Counts only: no content, no address, nothing finer than the hour. The person refused
              is told only to try again, never which check it was.
            </p>
            {flood.data.refusals.length === 0 ? (
              <p>Nothing has been refused in the last 24 hours.</p>
            ) : (
              <table className="w-full border-collapse text-sm">
                <caption className="sr-only">Refusals by hour and check</caption>
                <thead>
                  <tr className="border-b border-line text-left">
                    <th scope="col" className="py-1 pr-4">
                      Hour starting
                    </th>
                    {flood.data.checks.map((c) => (
                      <th key={c} scope="col" className="py-1 pr-4 text-right">
                        {c.replace(/_/g, ' ')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...new Set(flood.data.refusals.map((r) => r.hour))].map((h) => (
                    <tr key={h} className="border-b border-line">
                      <th scope="row" className="py-1 pr-4 text-left font-normal">
                        {hour(h)}
                      </th>
                      {flood.data.checks.map((c) => (
                        <td key={c} className="py-1 pr-4 text-right font-mono">
                          {flood.data.refusals.find((r) => r.hour === h && r.check === c)
                            ?.refusals ?? 0}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
          <Section title="Identical answers, the last 24 hours">
            {flood.data.identical.length === 0 ? (
              <p>No two reports share all their answers.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {flood.data.identical.map((g) => (
                  <li key={`${g.logbook_slug}-${g.answer_set}`}>
                    <Link
                      to="/moderate"
                      search={{ status: 'all', answer_set: g.answer_set }}
                      className="underline"
                    >
                      {`${String(g.reports)} reports with the same answers in ${g.logbook_slug}`}
                    </Link>
                    {` · ${String(g.pending)} waiting · ${when(g.first_at)} to ${when(g.last_at)}`}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      ) : null}
      <Lane />
      <LinkWindow />
    </Page>
  );
}

type TotalsData = ResponseOf<typeof getFloodScreen>['totals'];

const TOTAL_COLUMNS: [keyof TotalsData['all'], string][] = [
  ['received', 'Received'],
  ['accepted', 'Accepted'],
  ['declined', 'Declined'],
  ['waiting', 'Waiting'],
  ['withdrawn', 'Withdrawn'],
];

/**
 * Every report by where it stands, unapproved included. STAFF ONLY: the
 * public is told accepted reports, and declined ones by reason, nothing else
 * (decision 36, as amended by Plan E).
 */
function Totals({ totals }: { totals: TotalsData }) {
  const rows = [
    { key: 'all', name: 'Every logbook', ...totals.all },
    ...totals.by_logbook.map((l) => ({ key: l.slug, name: l.title, ...l })),
  ];
  return (
    <Section title="Every report, by where it stands">
      <p className="text-sm text-ink-alt">
        For staff only: the public sees accepted reports, and declined ones counted by reason.
        Waiting means not yet decided, or marked unclear. Received is the other four together.
      </p>
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Reports by logbook and where they stand</caption>
        <thead>
          <tr className="border-b border-line text-left">
            <th scope="col" className="py-1 pr-4">
              Logbook
            </th>
            {TOTAL_COLUMNS.map(([k, name]) => (
              <th key={k} scope="col" className="py-1 pr-4 text-right">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-line">
              <th scope="row" className="py-1 pr-4 text-left font-normal">
                {r.name}
              </th>
              {TOTAL_COLUMNS.map(([k]) => (
                <td key={k} className="py-1 pr-4 text-right font-mono">
                  {r[k]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm">
        {`Sent and not yet confirmed from the emailed link: ${String(totals.unconfirmed)}.`}
      </p>
    </Section>
  );
}

function Switches() {
  const qc = useQueryClient();
  const state = useQuery(switchesQuery);
  const done = async () => {
    await qc.invalidateQueries({ queryKey: ['moderation'] });
    await qc.invalidateQueries({ queryKey: intakePauseQuery.queryKey });
    await qc.invalidateQueries({ queryKey: ['board', 'switches'] });
  };
  const pause = useMutation({
    mutationFn: (paused: boolean) => call(setIntakePause, { body: { paused } }),
    onSuccess: done,
  });
  const puzzle = useMutation({
    mutationFn: (level: 'normal' | 'harder') => call(setPuzzleLevel, { body: { level } }),
    onSuccess: done,
  });
  if (!state.data) return null;
  const s = state.data;
  return (
    <Section title="Switches">
      <div className="flex flex-col gap-2">
        <p>
          {s.pause.paused
            ? `Intake is paused${s.pause.since ? ` since ${when(s.pause.since)}` : ''}. The report and tip forms say so, and a notice is on every page. Organizations still file.`
            : 'Intake is open.'}
        </p>
        <Button
          type="button"
          className="self-start"
          disabled={pause.isPending}
          onClick={() => {
            pause.mutate(!s.pause.paused);
          }}
        >
          {s.pause.paused ? 'Resume intake' : 'Pause intake'}
        </Button>
        {pause.isError ? <Alert tone="serious">{pause.error.message}</Alert> : null}
      </div>
      <div className="flex flex-col gap-2">
        <p>
          {s.puzzle === 'harder'
            ? 'The puzzle is harder: every report and tip takes longer to send.'
            : 'The puzzle is at its normal difficulty.'}
        </p>
        <Button
          type="button"
          variant="secondary"
          className="self-start"
          disabled={puzzle.isPending}
          onClick={() => {
            puzzle.mutate(s.puzzle === 'harder' ? 'normal' : 'harder');
          }}
        >
          {s.puzzle === 'harder' ? 'Put the puzzle back to normal' : 'Make the puzzle harder'}
        </Button>
        {puzzle.isError ? <Alert tone="serious">{puzzle.error.message}</Alert> : null}
      </div>
      <h3 className="font-semibold">Every use</h3>
      {s.uses.length === 0 ? (
        <p className="text-sm">No switch has been used.</p>
      ) : (
        <ul className="text-sm">
          {s.uses.slice(0, 20).map((u, i) => (
            <li key={`${u.at}-${String(i)}`}>
              <time dateTime={u.at}>{when(u.at)}</time> · {switchWords(u)} · {u.by}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Lane() {
  const lane = useQuery(laneQuery).data;
  if (!lane) return null;
  return (
    <Section title="Organizations">
      <p className="text-sm text-ink-alt">
        Reports an organization filed sort first in the queue. Open one organization’s to handle
        them as a set.
      </p>
      {lane.organizations.length === 0 ? (
        <p>No organization has filed yet.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {lane.organizations.map((o) => (
            <li key={o.id}>
              <Link
                to="/moderate"
                search={{ status: 'pending', organization: String(o.id) }}
                className="underline"
              >
                {o.name}
              </Link>
              {` · ${String(o.pending)} waiting of ${String(o.reports)}`}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Tip links withheld by time window. One check per link group, with who and when. */
function LinkWindow() {
  const qc = useQueryClient();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const run = useMutation({
    mutationFn: () =>
      call(bulkDeclineLinks, {
        body: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['moderation'] }),
  });
  return (
    <Section title="Tip links, by time window">
      <p className="text-sm text-ink-alt">
        Withholds every link that arrived in the window and nobody has checked yet. A withheld link
        is never shown to a journalist and is not erased; it can be checked again one by one. Links
        already checked are left as they are.
      </p>
      <form
        aria-label="Withhold tip links by time window"
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          run.mutate();
        }}
      >
        <Field>
          <Label>Arrived from</Label>
          <Input
            type="datetime-local"
            required
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
            }}
          />
        </Field>
        <Field>
          <Label>Arrived until</Label>
          <Input
            type="datetime-local"
            required
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
            }}
          />
        </Field>
        <Button type="submit" disabled={!from || !to || run.isPending}>
          Withhold these links
        </Button>
      </form>
      {run.isError ? <Alert tone="serious">{run.error.message}</Alert> : null}
      {run.data ? (
        <Alert tone="confirmed">{`Withheld ${String(run.data.withheld)} link groups.`}</Alert>
      ) : null}
    </Section>
  );
}
