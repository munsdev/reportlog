/**
 * Report and tip forms: what forms ask of reporters' email (how long a
 * confirmation link works, when report emails are deleted, how many reports
 * one address may file a day).
 *
 * WHAT IS NOT HERE, AND WHERE IT IS. The minimum time on a form, the puzzle's
 * difficulty and pausing intake are on the flood screen, with the other
 * defences against a flood (features/settings/MinFormTime.tsx). The limits
 * per network address are server settings (DOOR_SUBMITS_PER_MINUTE and the
 * rest, deploy/README.md). The sentence a refusal shows is a page wording
 * slot.
 */
import { getFilingLimits, setFilingLimits } from '@reportlog/contracts';
import type { FilingLimits } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { Note } from '@/mockup/Note.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { Field, FieldDescription, FieldError, Input, Label } from '@/mockup/Field.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { call } from '@/lib/api.ts';
import { GuardedPanel, SettingsFrame } from '../../../features/settings/panels.tsx';

const limitsQuery = queryOptions({
  queryKey: ['admin', 'filing-limits'],
  queryFn: ({ signal }) => call(getFilingLimits, { signal }),
});

export const Route = createFileRoute('/(staff)/settings/forms')({
  component: () => (
    <SettingsFrame>
      <FormsPage />
    </SettingsFrame>
  ),
});

/** A whole number from 1 to `max`, or the sentence saying what it must be. */
export function wholeProblem(text: string, max: number, what: string): string | null {
  const t = text.trim();
  if (!/^\d{1,4}$/.test(t) || Number(t) < 1 || Number(t) > max) {
    return `${what} must be a whole number from 1 to ${String(max)}.`;
  }
  return null;
}

const DATE_WORDS = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/**
 * Email on reports: how long a confirmation link works, the day every report
 * email is deleted, and how many reports one address may file in a day. A
 * closed panel until Change, like the other settings; never sealed.
 */
export function EmailOnReports({ limits }: { limits: FilingLimits }) {
  const client = useQueryClient();
  const toast = useToast();
  const [days, setDays] = useState(String(limits.link_days));
  const [on, setOn] = useState(limits.contacts_delete_on);
  const [cap, setCap] = useState(String(limits.address_daily_cap));
  const problems = [
    wholeProblem(days, 365, 'Days a link works'),
    /^\d{4}-\d{2}-\d{2}$/.test(on.trim())
      ? null
      : 'Write the date as year-month-day, like 2027-01-31.',
    wholeProblem(cap, 1000, 'Reports one address can file a day'),
  ];
  const dirty =
    days.trim() !== String(limits.link_days) ||
    on.trim() !== limits.contacts_delete_on ||
    cap.trim() !== String(limits.address_daily_cap);
  const save = useMutation({
    mutationFn: () =>
      call(setFilingLimits, {
        body: {
          link_days: Number(days.trim()),
          contacts_delete_on: on.trim(),
          address_daily_cap: Number(cap.trim()),
        },
      }),
    onSuccess: (next) => {
      client.setQueryData(limitsQuery.queryKey, next);
      toast.show('Saved. New reports use these from now.');
    },
  });
  const resetSave = save.reset;
  const cancel = useCallback(() => {
    setDays(String(limits.link_days));
    setOn(limits.contacts_delete_on);
    setCap(String(limits.address_daily_cap));
    resetSave();
  }, [limits, resetSave]);
  const firstProblem = problems.find((p) => p !== null) ?? null;
  return (
    <GuardedPanel
      id="email-on-reports"
      title="Email on reports"
      summary={[
        { key: 'A confirmation link works for', value: `${String(limits.link_days)} days` },
        { key: 'Every report email is deleted on', value: DATE_WORDS(limits.contacts_delete_on) },
        { key: 'Reports one address can file a day', value: String(limits.address_daily_cap) },
      ]}
      dirty={dirty}
      onSave={() => {
        if (firstProblem) return false;
        return save.mutateAsync();
      }}
      onCancel={cancel}
    >
      <p className="muted">
        Asked only when somebody writes something or adds a link; optional otherwise. A report with
        an email is filed when its link is pressed.
      </p>
      <Field>
        <Label>Days a confirmation link works</Label>
        <FieldDescription>
          A report waiting on its link is deleted whole when the link lapses.
        </FieldDescription>
        <Input
          inputMode="numeric"
          value={days}
          onChange={(e) => {
            setDays(e.target.value);
            save.reset();
          }}
        />
        <FieldError>{problems[0]}</FieldError>
      </Field>
      <Field>
        <Label>Delete every report email on</Label>
        <FieldDescription>
          Shown to reporters and in the privacy notice. Year-month-day, like 2027-01-31.
        </FieldDescription>
        <Input
          value={on}
          onChange={(e) => {
            setOn(e.target.value);
            save.reset();
          }}
        />
        <FieldError>{problems[1]}</FieldError>
      </Field>
      <Field>
        <Label>Reports one address can file a day</Label>
        <Input
          inputMode="numeric"
          value={cap}
          onChange={(e) => {
            setCap(e.target.value);
            save.reset();
          }}
        />
        <FieldError>{problems[2]}</FieldError>
      </Field>
      {save.isError ? (
        <Note tone="serious" title="That was not saved.">
          {save.error.message}
        </Note>
      ) : null}
    </GuardedPanel>
  );
}

function FormsPage() {
  const limits = useQuery(limitsQuery);
  return (
    <StaffPage title="Report and tip forms" lede="How forms tell people from scripts.">
      <p className="muted">
        Each form solves a small puzzle in the visitor’s own browser, carries a box nobody can see,
        and must have been open for a moment before it is sent. How many one network address may
        send is limited too. Anything turned away is told only to try again, and counted.
      </p>
      {limits.isPending ? <p role="status">Loading…</p> : null}
      {limits.isError ? (
        <Note tone="serious" title="The settings could not be read.">
          {limits.error.message}
        </Note>
      ) : null}
      {limits.data ? <EmailOnReports limits={limits.data} /> : null}
      <Panel kind="quiet" title="Set elsewhere">
        <p>
          <Link to="/moderate/flood">
            The puzzle, the minimum time on a form, and pausing intake
          </Link>{' '}
          (on the flood screen, with the other defences against a flood) ·{' '}
          <Link to="/settings/words">The wording on forms</Link> (“When a form is turned away”)
        </p>
        <p className="muted">
          How many reports and tips one network address may send per minute and per hour are the
          server’s settings, DOOR_SUBMITS_PER_MINUTE and DOOR_SUBMITS_PER_HOUR.
        </p>
      </Panel>
    </StaffPage>
  );
}
