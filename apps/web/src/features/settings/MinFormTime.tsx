/**
 * The minimum time a form must have been open before it is sent: one of the
 * checks at the door (apps/api/src/door/). Drawn on the flood screen, beside
 * the other defences against a flood (staff-nav/menu.ts); administrators
 * only, as the server asks.
 */
import { getDoorSettings, setDoorSettings } from '@reportlog/contracts';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Note } from '@/mockup/Note.tsx';
import { Field, FieldDescription, FieldError, Input, Label } from '@/mockup/Field.tsx';
import { SaveBar } from '@/mockup/SaveBar.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { call } from '@/lib/api.ts';
import { useUnsavedChanges } from '../../routes/(staff)/settings/-editor.tsx';

export const doorQuery = queryOptions({
  queryKey: ['admin', 'door'],
  queryFn: ({ signal }) => call(getDoorSettings, { signal }),
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
      className="form-stack"
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
        <Note tone="serious" title="That was not saved.">
          {save.error.message}
        </Note>
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
