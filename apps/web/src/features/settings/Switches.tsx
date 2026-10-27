/**
 * The settings that apply the moment they are pressed: whether the site
 * takes new reports, and the development notice. Neither is a form, so
 * neither has Save or a Save bar. Each is a pair of choice cards and one
 * button that does what the chosen card says; the result is a toast, and
 * an error stays on the page as an alert (settings-and-admin.md §02).
 *
 * DELIBERATE DIFFERENCE FROM THE MOCK-UP. The mock-up draws Accepting reports
 * and the development notice as an instant switch. Here closing intake keeps
 * its two acts (choose the card, press the button) because it refuses
 * somebody part-way through a form; the development notice keeps the same
 * pair so the two read alike. Their summaries ("Accepting: Yes") are the
 * mock-up's.
 *
 * ASKED BEFORE, NEVER AFTER. Closing the site to reports stops somebody
 * part-way through a form, so it takes two acts: choosing the card that says
 * what will happen, then pressing the button. Nothing is sent by choosing.
 */
import { getDevMode, getIntakePause, setDevMode, setIntakeSwitch } from '@reportlog/contracts';
import type { DevMode } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Note } from '@/mockup/Note.tsx';
import { Btn } from '@/mockup/Btn.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { Dl } from '@/mockup/Dl.tsx';
import { RadioGroup, RadioOption } from '@/mockup/Choices.tsx';
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
  const [choice, setChoice] = useState<'on' | 'off' | null>(null);
  const save = useMutation({
    mutationFn: (open: boolean) => call(setIntakeSwitch, { body: { open } }),
    onSuccess: async (data) => {
      setChoice(null);
      qc.setQueryData(intakeSwitchQuery().queryKey, data);
      toast.show(data.open ? 'Accepting reports is now on.' : 'Accepting reports is now off.');
      await qc.invalidateQueries({ queryKey: intakeSwitchQuery().queryKey });
    },
  });

  const title = 'Accepting reports';
  if (query.isPending) {
    return (
      <Panel heading={title}>
        <p role="status">Reading the intake switch…</p>
      </Panel>
    );
  }
  if (query.isError) {
    return (
      <Panel heading={title}>
        <Note tone="serious" title="The intake switch could not be read.">
          {query.error.message}
        </Note>
      </Panel>
    );
  }
  const now = query.data.open ? 'on' : 'off';
  const chosen = choice ?? now;
  return (
    <Panel heading={title}>
      <Dl
        items={[
          { key: 'Accepting', value: yesNo(query.data.open) },
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
        <p className="text-sm text-ink-alt">Nobody has set this; taking reports is the default.</p>
      ) : null}
      <RadioGroup
        aria-label="New reports, across the site"
        value={chosen}
        onValueChange={(v) => {
          save.reset();
          setChoice(v === now ? null : (v as 'on' | 'off'));
        }}
      >
        <RadioOption
          value="on"
          label="Taking new reports"
          hint="Every logbook that is open takes reports."
        />
        <RadioOption
          value="off"
          label="Not taking new reports"
          hint="Every logbook’s form says it is not taking reports, and somebody part-way through one is refused when they send it. Reports already filed are unaffected, and corrections to them still work."
        />
      </RadioGroup>
      {save.isError ? (
        <Note tone="serious" title="That did not change.">
          {save.error.message}
        </Note>
      ) : null}
      {chosen !== now ? (
        <div>
          <Btn
            busy={save.isPending}
            busyLabel="Changing…"
            onClick={() => {
              save.mutate(chosen === 'on');
            }}
          >
            {chosen === 'on' ? 'Turn it on' : 'Turn it off'}
          </Btn>
        </div>
      ) : null}
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
  const [choice, setChoice] = useState<'on' | 'off' | null>(null);
  const change = useMutation({
    mutationFn: (hours: number | null) => call(setDevMode, { body: { hours } }),
    onSuccess: (next) => {
      setChoice(null);
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
  const now = state.active ? 'on' : 'off';
  const chosen = choice ?? now;
  // "On" chosen while it is already on renews the window from now.
  const pressable = chosen !== now || chosen === 'on';
  return (
    <Panel heading="Development notice">
      <Dl
        items={[
          {
            key: 'Showing',
            value: state.active && state.until ? `Yes, until ${when(state.until)}` : 'No',
          },
          { key: 'After a release', value: `On by itself for ${hours} hours` },
        ]}
      />
      <p role="status" className="sr-only">
        {devNoticeNow(state)}
      </p>
      <RadioGroup
        aria-label="The development notice"
        value={chosen}
        onValueChange={(v) => {
          change.reset();
          setChoice(v === now ? null : (v as 'on' | 'off'));
        }}
      >
        <RadioOption
          value="on"
          label={`On for ${hours} hours from now`}
          hint="While you are making changes by hand. It switches itself off."
        />
        <RadioOption
          value="off"
          label="Off now"
          hint={`The next release turns it on again for ${hours} hours by itself.`}
        />
      </RadioGroup>
      {change.isError ? (
        <Note tone="serious" title="That did not change.">
          {change.error.message}
        </Note>
      ) : null}
      {pressable ? (
        <div>
          <Btn
            busy={change.isPending}
            busyLabel="Changing…"
            onClick={() => {
              change.mutate(chosen === 'on' ? state.default_hours : null);
            }}
          >
            {chosen === 'on'
              ? now === 'on'
                ? `Show it for ${hours} hours from now`
                : 'Turn it on'
              : 'Turn it off'}
          </Btn>
        </div>
      ) : null}
    </Panel>
  );
}

/** The panel, once the notice's state has been read. */
export function DevNotice() {
  const state = useQuery(devModeQuery);
  if (state.isPending)
    return (
      <Panel heading="Development notice">
        <p role="status">Loading…</p>
      </Panel>
    );
  if (state.isError)
    return (
      <Panel heading="Development notice">
        <Note tone="serious" title="The notice’s state could not be read.">
          {state.error.message}
        </Note>
      </Panel>
    );
  return <DevNoticePanel state={state.data} />;
}
