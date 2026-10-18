/**
 * What the site calls itself. Double quotes mark part of the name in the
 * accent colour, single quotes in the quieter second accent; the preview
 * shows exactly what the header will draw. Clearing it goes back to the
 * software's own name.
 */
import {
  MAX_SITE_NAME,
  accentMarksClose,
  parseBrand,
  plainName,
  setSiteName,
} from '@reportlog/contracts';
import type { SiteEditor } from '@reportlog/contracts';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Field, FieldDescription, FieldError } from '@/components/ui/field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Page } from '@/components/ui/page.tsx';
import { BrandName } from '@/components/ui/site.tsx';
import { call } from '@/lib/api.ts';
import { SaveOutcome, WithEditor, useSave } from './-editor.tsx';

export const Route = createFileRoute('/(staff)/settings/name')({
  component: () => (
    <Page title="Name" width="prose">
      <WithEditor>{(state) => <NameForm state={state} />}</WithEditor>
    </Page>
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
  const save = useSave((value: string | null) => call(setSiteName, { body: { name: value } }));
  const problem = nameProblem(name);
  const preview = name.trim() || state.effective_name;

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!problem) save.mutate(name.trim() || null);
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
          }}
          autoComplete="off"
        />
        <FieldError>{problem}</FieldError>
      </Field>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold">How the header will show it</p>
        <p className="rounded-card bg-deep px-4 py-3 font-display text-xl font-bold text-on-deep">
          <BrandName parts={parseBrand(preview)} onDeep />
        </p>
      </div>

      <SaveOutcome mutation={save} done="The new name is live." />
      <div>
        <Button type="submit" disabled={Boolean(problem) || save.isPending}>
          Save the name
        </Button>
      </div>
    </form>
  );
}
