/**
 * At the door: the one setting of the checks every report and tip passes
 * before it is read (apps/api/src/door/). The minimum time a form must have
 * been open before it is sent.
 *
 * WHAT IS NOT HERE, AND WHERE IT IS. The puzzle's difficulty is the
 * moderators' "Harder puzzle" switch on the flood screen, recorded and shown
 * publicly. The limits per network address are server settings
 * (DOOR_SUBMITS_PER_MINUTE and the rest, deploy/README.md). The sentence a
 * refusal shows is a page wording slot.
 *
 * One setting on its own page: the field is open from the start, and the
 * Save bar appears once there is a change to save.
 */
import { getDoorSettings, setDoorSettings } from '@reportlog/contracts';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Field, FieldDescription, FieldError } from '@/components/ui/field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Page } from '@/components/ui/page.tsx';
import { SaveBar } from '@/components/ui/save-bar.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { call } from '@/lib/api.ts';
import { SettingsFrame } from '../../../features/settings/panels.tsx';
import { useUnsavedChanges } from './-editor.tsx';

const doorQuery = queryOptions({
  queryKey: ['admin', 'door'],
  queryFn: ({ signal }) => call(getDoorSettings, { signal }),
});

export const Route = createFileRoute('/(staff)/settings/forms')({
  component: () => (
    <SettingsFrame>
      <FormsPage />
    </SettingsFrame>
  ),
});

/** A whole number of seconds from 0 to 600, or the sentence saying what it must be. */
export function minFormProblem(text: string): string | null {
  const t = text.trim();
  if (!/^\d{1,3}$/.test(t) || Number(t) > 600)
    return 'Write a whole number of seconds from 0 to 600.';
  return null;
}

export function MinFormTime({ seconds }: { seconds: number }) {
  const client = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState(String(seconds));
  const problem = minFormProblem(text);
  const dirty = text.trim() !== String(seconds);
  useUnsavedChanges('the minimum time on a form', dirty);
  const save = useMutation({
    mutationFn: () => call(setDoorSettings, { body: { min_form_seconds: Number(text.trim()) } }),
    onSuccess: (next) => {
      client.setQueryData(doorQuery.queryKey, next);
      setText(String(next.min_form_seconds));
      toast.show('Saved. Forms are checked with the new time from now.');
    },
  });
  const submit = () => {
    if (!problem) save.mutate();
  };
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field>
        <Label>Minimum time on a form, in seconds</Label>
        <FieldDescription>
          A report or tip sent sooner than this after its form was opened is turned away, as
          something no person could have read. Three seconds is a cautious start; raise it during a
          flood if fast scripts are getting through. 0 turns this check off.
        </FieldDescription>
        <Input
          inputMode="numeric"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            save.reset();
          }}
        />
        <FieldError>{text.trim() ? problem : null}</FieldError>
      </Field>
      {save.isError ? (
        <Alert tone="serious" title="That was not saved.">
          {save.error.message}
        </Alert>
      ) : null}
      {dirty ? (
        <SaveBar
          name="Minimum time on a form"
          busy={save.isPending}
          onSave={submit}
          onCancel={() => {
            setText(String(seconds));
            save.reset();
          }}
        />
      ) : null}
    </form>
  );
}

function FormsPage() {
  const state = useQuery(doorQuery);
  return (
    <Page
      title="Report and tip forms"
      width="prose"
      lede="The checks every report and tip passes before this site reads it."
    >
      <p>
        Each form solves a small puzzle in the visitor’s own browser, carries a box nobody can see,
        and must have been open for a moment before it is sent. How many one network address may
        send is limited too. Anything turned away is told only to try again, and counted.
      </p>
      {state.isPending ? <p role="status">Loading…</p> : null}
      {state.isError ? (
        <Alert tone="serious" title="The settings could not be read.">
          {state.error.message}
        </Alert>
      ) : null}
      {state.data ? (
        <Card heading="The minimum time on a form">
          <MinFormTime seconds={state.data.min_form_seconds} />
        </Card>
      ) : null}
      <Card variant="quiet">
        <h2 className="font-display text-xl font-bold">Set elsewhere</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            How hard the puzzle is: the “Harder puzzle” switch on the{' '}
            <Link to="/moderate/flood" className="underline">
              flood screen
            </Link>
            , where each use is recorded and shown publicly.
          </li>
          <li>
            The sentence a visitor sees when a form is turned away:{' '}
            <Link to="/settings/words" className="underline">
              Wording
            </Link>
            , “When a form is turned away”.
          </li>
          <li>
            How many reports and tips one network address may send per minute and per hour: the
            server’s settings, DOOR_SUBMITS_PER_MINUTE and DOOR_SUBMITS_PER_HOUR.
          </li>
        </ul>
      </Card>
    </Page>
  );
}
