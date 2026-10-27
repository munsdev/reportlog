/**
 * The settings that apply the moment they are pressed: whether the site
 * takes new reports, and the development notice. Neither is a form, so
 *
 * Both are the mock-up's instant switch. ASKED BEFORE, NEVER AFTER: closing
 * the site to reports stops somebody part-way through a form, so turning that
 * switch off first asks, in a dialog that says what will happen, and nothing
 * is sent until it is confirmed. Turning it on needs no question.
 */
import { getDevMode, getIntakePause, setDevMode, setIntakeSwitch } from '@reportlog/contracts';
import type { DevMode } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Note } from '@/mockup/Note.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { Dl } from '@/mockup/Dl.tsx';
import { Btn } from '@/mockup/Btn.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/mockup/Dialog.tsx';
import { Switch } from '@/mockup/Switch.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { call } from '@/lib/api.ts';
import { intakeSwitchQuery, logbooksQuery } from '../builder/queries.ts';

export const intakePauseQuery = queryOptions({
  queryKey: ['intake-pause'],
  queryFn: ({ signal }) => call(getIntakePause, { signal }),
});

export const devModeQuery = queryOptions({
  queryKey: ['site-editor', 'dev-mode'],
  queryFn: ({ signal }) => call(getDevMode, { signal }),
});

const yesNo = (b: boolean) => (b ? 'Yes' : 'No');

/** "2 of 3": logbooks taking reports, of those launched. */
function openCount(logbooks: readonly { state: string }[]): string {
  const launched = logbooks.filter((l) => l.state !== 'draft');
  const open = launched.filter((l) => l.state === 'open');
  return `${String(open.length)} of ${String(launched.length)}`;
}

/**
 * Accepting reports: the site-wide intake switch. It was on the logbook
 * list as "New reports, across the site"; the overview is where the whole
 * site's state is read.
 */
export function AcceptingReportsPanel() {
  const qc = useQueryClient();
  const toast = useToast();
  const query = useQuery(intakeSwitchQuery());
  const pause = useQuery(intakePauseQuery);
  const logbooks = useQuery(logbooksQuery());
  const [asking, setAsking] = useState(false);
  const save = useMutation({
    mutationFn: (open: boolean) => call(setIntakeSwitch, { body: { open } }),
    onSuccess: async (data) => {
      setAsking(false);
      qc.setQueryData(intakeSwitchQuery().queryKey, data);
      toast.show(data.open ? 'Accepting reports is now on.' : 'Accepting reports is now off.');
      await qc.invalidateQueries({ queryKey: intakeSwitchQuery().queryKey });
    },
  });

  const title = 'Accepting reports';
  if (query.isPending) {
    return (
      <Panel title={title}>
        <p role="status">Reading the intake switch…</p>
      </Panel>
    );
  }
  if (query.isError) {
    return (
      <Panel title={title}>
        <Note tone="serious" title="The intake switch could not be read.">
          {query.error.message}
        </Note>
      </Panel>
    );
  }
  return (
    <Panel title={title}>
      <Switch
        label="Taking new reports"
        help="Every open logbook and list."
        checked={query.data.open}
        busy={save.isPending}
        onChange={(next) => {
          save.reset();
          if (next) save.mutate(true);
          else setAsking(true);
        }}
      />
      <p className="m">
        Turning it off is the same switch as Pause intake on the flood screen, and is recorded
        publicly.
      </p>
      <Dl
        items={[
          {
            key: 'Paused by the flood screen',
            value: pause.data ? yesNo(pause.data.paused) : '…',
          },
          {
            key: 'Logbooks open',
            value: logbooks.data ? openCount(logbooks.data.logbooks) : '…',
            mono: true,
          },
        ]}
      />
      {query.data.stored === null ? (
        <p className="muted">Nobody has set this; taking reports is the default.</p>
      ) : null}
      {save.isError && !asking ? (
        <Note tone="serious" title="That did not change.">
          {save.error.message}
        </Note>
      ) : null}
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stop taking new reports?</DialogTitle>
            <DialogDescription>
              Every logbook’s form says it is not taking reports, and somebody part-way through one
              is refused when they send it. Reports already filed are unaffected, and corrections to
              them still work.
            </DialogDescription>
          </DialogHeader>
          {save.isError ? (
            <Note tone="serious" title="That did not change.">
              {save.error.message}
            </Note>
          ) : null}
          <DialogFooter>
            <Btn look="bad" sm flat
              
              busy={save.isPending}
              busyLabel="Changing…"
              onClick={() => {
                save.mutate(false);
              }}
            >
              Turn it off
            </Btn>
            <Btn look="ghost" sm flat
              
              onClick={() => {
                setAsking(false);
              }}
            >
              Cancel
            </Btn>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** What the notice is doing now, in words: the panel's summary and the status line. */
export function devNoticeNow(state: DevMode): string {
  return state.active && state.until
    ? `The notice is showing until ${when(state.until)}.`
    : 'The notice is not showing.';
}

/**
 * The development notice. A deploy turns it on for a few hours by itself;
 * this is the manual override, on for a window from now, or off now.
 */
export function DevNoticePanel({ state }: { state: DevMode }) {
  const client = useQueryClient();
  const toast = useToast();
  const change = useMutation({
    mutationFn: (hours: number | null) => call(setDevMode, { body: { hours } }),
    onSuccess: (next) => {
      client.setQueryData(devModeQuery.queryKey, next);
      // Every page reads the notice from the site's settings.
      void client.invalidateQueries({ queryKey: ['site'] });
      toast.show(
        next.active && next.until
          ? `The development notice is now on, until ${when(next.until)}.`
          : 'The development notice is now off.',
      );
    },
  });
  const hours = String(state.default_hours);
  return (
    <Panel title="Development notice">
      <Switch
        label={state.active && state.until ? `On until ${when(state.until)}` : 'Off'}
        help={`Shows “Under active development” in a corner of every page. A release turns it on by itself for ${hours} hours.`}
        checked={state.active}
        busy={change.isPending}
        onChange={(next) => {
          change.reset();
          change.mutate(next ? state.default_hours : null);
        }}
      />
      <p role="status" className="vh">
        {devNoticeNow(state)}
      </p>
      {change.isError ? (
        <Note tone="serious" title="That did not change.">
          {change.error.message}
        </Note>
      ) : null}
    </Panel>
  );
}

/** The panel, once the notice's state has been read. */
export function DevNotice() {
  const state = useQuery(devModeQuery);
  if (state.isPending)
    return (
      <Panel title="Development notice">
        <p role="status">Loading…</p>
      </Panel>
    );
  if (state.isError)
    return (
      <Panel title="Development notice">
        <Note tone="serious" title="The notice’s state could not be read.">
          {state.error.message}
        </Note>
      </Panel>
    );
  return <DevNoticePanel state={state.data} />;
}
