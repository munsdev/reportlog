/**
 * What the site calls itself. Double quotes mark part of the name in the
 * accent colour, single quotes in the quieter second accent; the previews
 * show exactly what the header will draw, on the deep bar it sits on, and
 * how the name reads on the page's own ground (the password screen, the
 * emails' heading). Clearing it goes back to the software's own name.
 *
 * ONE SETTING ON ITS OWN PAGE, so the field is open from the start rather
 * than behind an Edit button; the Save bar appears once there is something
 * to save, names it, and Escape puts the field back.
 */
import { MAX_SITE_NAME, accentMarksClose, plainName, setSiteName } from '@reportlog/contracts';
import type { SiteEditor } from '@reportlog/contracts';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Note } from '@/mockup/Note.tsx';
import { Field, FieldDescription, FieldError } from '@/mockup/Field.tsx';
import { Input } from '@/mockup/Field.tsx';
import { Label } from '@/mockup/Field.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { SaveBar } from '@/mockup/SaveBar.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { call } from '@/lib/api.ts';
import { NamePreview } from '../../../features/settings/NamePreview.tsx';
import { SettingsFrame } from '../../../features/settings/panels.tsx';
import { WithEditor, useSave, useUnsavedChanges } from './-editor.tsx';

export const Route = createFileRoute('/(staff)/settings/name')({
  component: () => (
    <SettingsFrame>
      <StaffPage
        title="Name"
        width="prose"
        lede="How the name is drawn in the header and the footer."
      >
        <WithEditor>{(state) => <NameForm state={state} />}</WithEditor>
      </StaffPage>
    </SettingsFrame>
  ),
});

/** What is wrong with the name as typed, before anything is sent. */
export function nameProblem(raw: string): string | null {
  if (plainName(raw.trim()).length > MAX_SITE_NAME) {
    return `Keep the name under ${String(MAX_SITE_NAME)} characters.`;
  }
  if (!accentMarksClose(raw)) {
    return 'Close the quotes, or leave them out. A pair of double quotes marks part of the name in the accent colour.';
  }
  return null;
}

export function NameForm({ state }: { state: SiteEditor }) {
  const [name, setName] = useState(state.name ?? '');
  const toast = useToast();
  const save = useSave((value: string | null) => call(setSiteName, { body: { name: value } }));
  const problem = nameProblem(name);
  const preview = name.trim() || state.effective_name;
  const dirty = (name.trim() || null) !== state.name;
  useUnsavedChanges('the name', dirty);

  const submit = () => {
    if (problem) return;
    save.mutate(name.trim() || null, {
      onSuccess: (next) => {
        setName(next.name ?? '');
        toast.show('The new name is live.');
      },
    });
  };

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field>
        <Label>The site’s name</Label>
        <FieldDescription>
          Put part of it in "double quotes" to draw it in the accent colour, or in 'single quotes'
          for a quieter second accent. Leave it empty to use “ReportLog”.
        </FieldDescription>
        <Input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            save.reset();
          }}
          autoComplete="off"
        />
        <FieldError>{problem}</FieldError>
      </Field>

      <NamePreview name={preview} />

      {save.isError ? (
        <Note tone="serious" title="That was not saved.">
          {save.error.message}
        </Note>
      ) : null}
      {dirty ? (
        <SaveBar
          name="This site’s name"
          busy={save.isPending}
          onSave={submit}
          onCancel={() => {
            setName(state.name ?? '');
            save.reset();
          }}
        />
      ) : null}
    </form>
  );
}
