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
import { hasAdminAuthority } from '@reportlog/access';
import { bulkDeclineLinks, setIntakePause, setPuzzleLevel } from '@reportlog/contracts';
import type { ResponseOf, getFloodScreen } from '@reportlog/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Bars } from '../../mockup/Bars.tsx';
import { Btn } from '../../mockup/Btn.tsx';
import { Field, Input, Label } from '@/mockup/Field.tsx';
import { Note } from '../../mockup/Note.tsx';
import { Problem } from '../../mockup/Notice.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { Switch } from '../../mockup/Switch.tsx';
import { Tbl } from '../../mockup/Tbl.tsx';
import { StaffPage } from '../nav/StaffPage.tsx';
import { useMe } from '../identity/session.ts';
import { MinFormTime, doorQuery } from '../settings/MinFormTime.tsx';
import { ToastProvider, useToast } from '../../components/ui/toast.tsx';
import { call } from '../../lib/api.ts';
import { switchWords } from '../board/Activity.tsx';
import { intakePauseQuery } from './IntakePaused.tsx';
import { floodQuery, laneQuery, switchesQuery } from './queries.ts';

const hour = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { timeStyle: 'short' });
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * The minimum time on a form, moved here from Report and tip forms so every
 * defence against a flood is on one screen. Administrators only: the server
 * refuses anybody else, so a moderator is not shown it.
 */
function FormTime() {
  const me = useMe();
  const admin = me.data?.signedIn === true && hasAdminAuthority(me.data.roles);
  const door = useQuery({ ...doorQuery, enabled: admin });
  if (!admin) return null;
  return (
    <Panel title="The minimum time on a form">
      {door.isError ? <Problem>{door.error.message}</Problem> : null}
      {door.data ? <MinFormTime seconds={door.data.min_form_seconds} /> : null}
    </Panel>
  );
}

export function FloodScreen() {
  return (
    <ToastProvider>
      <FloodBody />
    </ToastProvider>
  );
}

function FloodBody() {
  const qc = useQueryClient();
  const flood = useQuery(floodQuery);
  const refusedHours = flood.data ? [...new Set(flood.data.refusals.map((r) => r.hour))] : [];
  return (
    <StaffPage
      title="Flood screen"
      lede="What is arriving, and the switches for when too much is. Every switch use is recorded with your name and shown publicly with its time."
      actions={
        <Btn
          sm
          flat
          onClick={() => {
            void qc.invalidateQueries({ queryKey: ['moderation'] });
          }}
        >
          Read again
        </Btn>
      }
    >
      <Switches />
      <FormTime />
      {flood.isPending ? <p role="status">Counting…</p> : null}
      {flood.isError ? <Problem>{flood.error.message}</Problem> : null}
      {flood.data ? (
        <>
          <Panel title="Submissions per hour, the last 24 hours">
            <Bars
              label="Reports and tips that arrived, by hour"
              items={flood.data.hours.map((h) => ({
                label: `${hour(h.hour)} · ${String(h.reports)} reports, ${String(h.tips)} tips`,
                value: h.reports + h.tips,
              }))}
            />
          </Panel>
          <Panel title="Refused at the door, per hour, by check">
            <p className="muted">
              Counts only: no content, no address, nothing finer than the hour. The person refused
              is told only to try again, never which check it was.
            </p>
            {flood.data.refusals.length === 0 ? (
              <p>Nothing has been refused in the last 24 hours.</p>
            ) : (
              <Tbl
                cols={['Hour', ...flood.data.checks.map((c) => c.replace(/_/g, ' '))]}
                rows={refusedHours.map((h) => ({
                  key: h,
                  cells: [
                    hour(h),
                    ...flood.data.checks.map((c) =>
                      String(
                        flood.data.refusals.find((r) => r.hour === h && r.check === c)?.refusals ??
                          0,
                      ),
                    ),
                  ],
                }))}
              />
            )}
          </Panel>
          <Panel title="Identical answers, the last 24 hours">
            {flood.data.identical.length === 0 ? (
              <p>No two reports share all their answers.</p>
            ) : (
              flood.data.identical.map((g) => (
                <p key={`${g.logbook_slug}-${g.answer_set}`}>
                  <Link to="/moderate" search={{ status: 'all', answer_set: g.answer_set }}>
                    {`${String(g.reports)} reports with the same answers in ${g.logbook_slug}`}
                  </Link>
                  {` · ${String(g.pending)} waiting · ${when(g.first_at)} to ${when(g.last_at)}`}
                </p>
              ))
            )}
            <p className="muted">
              Decline reports in bulk: go to the <Link to="/moderate">queue</Link>, filter by
              arrival time, select all.
            </p>
          </Panel>
          <Totals totals={flood.data.totals} />
        </>
      ) : null}
      <Lane />
      <LinkWindow />
    </StaffPage>
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
    <Panel title="Every report, by where it stands">
      <p className="muted">
        For staff only: the public sees accepted reports, and declined ones counted by reason.
        Waiting means not yet decided, or marked unclear. Received is the other four together.
      </p>
      <Tbl
        widths="1.4fr repeat(5,1fr)"
        cols={['Logbook', ...TOTAL_COLUMNS.map(([, name]) => name)]}
        rows={rows.map((r) => ({
          key: r.key,
          cells: [r.name, ...TOTAL_COLUMNS.map(([k]) => String(r[k]))],
        }))}
      />
      <p className="m">
        {`Sent and not yet confirmed from the emailed link: ${String(totals.unconfirmed)}.`}
      </p>
    </Panel>
  );
}

/**
 * The switches, first and on the deep surface: in a flood they are what the
 * person came for. Each asks for the second factor again (the API client
 * shows the prompt), then says it took effect in a toast.
 */
function Switches() {
  const qc = useQueryClient();
  const toast = useToast();
  const state = useQuery(switchesQuery);
  const done = async () => {
    await qc.invalidateQueries({ queryKey: ['moderation'] });
    await qc.invalidateQueries({ queryKey: intakePauseQuery.queryKey });
    await qc.invalidateQueries({ queryKey: ['board', 'switches'] });
  };
  const pause = useMutation({
    mutationFn: (paused: boolean) => call(setIntakePause, { body: { paused } }),
    onSuccess: async (_out, paused) => {
      toast.show(
        paused
          ? 'Intake is paused. The forms say so and a notice is on every page.'
          : 'Intake is open again.',
      );
      await done();
    },
  });
  const puzzle = useMutation({
    mutationFn: (level: 'normal' | 'harder') => call(setPuzzleLevel, { body: { level } }),
    onSuccess: async (_out, level) => {
      toast.show(
        level === 'harder'
          ? 'The puzzle is harder now. Every report and tip takes longer to send.'
          : 'The puzzle is back to normal.',
      );
      await done();
    },
  });
  if (!state.data) return null;
  const s = state.data;
  return (
    <Panel kind="deep" title="Switches">
      <Switch
        label="Intake"
        help={
          s.pause.paused
            ? `Intake is paused${s.pause.since ? ` since ${when(s.pause.since)}` : ''}. The report and tip forms say so, and a notice is on every page. Organizations still file.`
            : 'Intake is open.'
        }
        checked={!s.pause.paused}
        disabled={pause.isPending}
        onChange={() => {
          pause.mutate(!s.pause.paused);
        }}
      />
      <Switch
        label="The puzzle"
        help={
          s.puzzle === 'harder'
            ? 'The puzzle is harder: every report and tip takes longer to send.'
            : 'Normal difficulty.'
        }
        checked={s.puzzle === 'harder'}
        disabled={puzzle.isPending}
        onChange={() => {
          puzzle.mutate(s.puzzle === 'harder' ? 'normal' : 'harder');
        }}
      />
      <p className="m">Every use is recorded publicly on the board’s activity page.</p>
      <div className="acts">
        <Btn
          sm
          flat
          className={s.pause.paused ? '' : 'bad'}
          disabled={pause.isPending}
          onClick={() => {
            pause.mutate(!s.pause.paused);
          }}
        >
          {pause.isPending
            ? s.pause.paused
              ? 'Resuming…'
              : 'Pausing…'
            : s.pause.paused
              ? 'Resume intake'
              : 'Pause intake'}
        </Btn>
        <Btn
          sm
          flat
          disabled={puzzle.isPending}
          onClick={() => {
            puzzle.mutate(s.puzzle === 'harder' ? 'normal' : 'harder');
          }}
        >
          {puzzle.isPending
            ? 'Changing…'
            : s.puzzle === 'harder'
              ? 'Put the puzzle back to normal'
              : 'Make the puzzle harder'}
        </Btn>
      </div>
      {pause.isError ? <Problem>{pause.error.message}</Problem> : null}
      {puzzle.isError ? <Problem>{puzzle.error.message}</Problem> : null}
      <span className="lbl" id="switch-uses">
        Every use
      </span>
      {s.uses.length === 0 ? (
        <p className="m">No switch has been used.</p>
      ) : (
        // Scrolls sideways on a narrow screen, so it takes focus to be scrolled by keyboard.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        <div className="code" role="region" aria-labelledby="switch-uses" tabIndex={0}>
          {s.uses
            .slice(0, 20)
            .map((u) => `${when(u.at)} · ${switchWords(u)} · ${u.by}`)
            .join('\n')}
        </div>
      )}
    </Panel>
  );
}

function Lane() {
  const lane = useQuery(laneQuery).data;
  if (!lane) return null;
  return (
    <Panel title="Organizations">
      <p className="muted">
        Reports an organization filed sort first in the queue. Open one organization’s to handle
        them as a set.
      </p>
      {lane.organizations.length === 0 ? (
        <p>No organization has filed yet.</p>
      ) : (
        lane.organizations.map((o) => (
          <p key={o.id}>
            <Link to="/moderate" search={{ status: 'pending', organization: String(o.id) }}>
              {o.name}
            </Link>
            {` · ${String(o.pending)} waiting of ${String(o.reports)}`}
          </p>
        ))
      )}
    </Panel>
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
    <Panel title="Tip links, by time window">
      <p className="muted">
        Withholds every link that arrived in the window and nobody has checked yet. A withheld link
        is never shown to a journalist and is not erased; it can be checked again one by one. Links
        already checked are left as they are.
      </p>
      <form
        aria-label="Withhold tip links by time window"
        className="col"
        onSubmit={(e) => {
          e.preventDefault();
          run.mutate();
        }}
      >
        <div className="grid2 even">
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
        </div>
        <div className="acts">
          <Btn sm flat type="submit" disabled={!from || !to || run.isPending}>
            {run.isPending ? 'Withholding…' : 'Withhold these'}
          </Btn>
        </div>
      </form>
      {run.isError ? <Problem>{run.error.message}</Problem> : null}
      {run.data ? <Note>{`Withheld ${String(run.data.withheld)} link groups.`}</Note> : null}
    </Panel>
  );
}
