/**
 * The words on the site's own pages, one slot at a time. Plain text,
 * published exactly as typed in a place the design already put it. Each
 * slot says whether it still carries the shipped wording, so nobody
 * believes they wrote something they did not.
 *
 * What the software says about itself (how a report is sealed, the consent
 * wording, the verify page) is not here and cannot be.
 */
import { setCopy } from '@reportlog/contracts';
import type { CopySlot } from '@reportlog/contracts';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Field, FieldDescription } from '@/components/ui/field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Page } from '@/components/ui/page.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { call } from '@/lib/api.ts';
import { SaveOutcome, WithEditor, useSave } from './-editor.tsx';

export const Route = createFileRoute('/(staff)/settings/words')({
  component: () => (
    <Page title="Page wording" lede="What this archive is for, in your own words." width="prose">
      <WithEditor>
        {(state) => (
          <div className="flex flex-col gap-6">
            {state.copy.map((slot) => (
              <SlotEditor key={slot.key} slot={slot} />
            ))}
          </div>
        )}
      </WithEditor>
    </Page>
  ),
});

export function SlotEditor({ slot }: { slot: CopySlot }) {
  const [body, setBody] = useState(slot.body);
  const save = useSave((value: string) =>
    call(setCopy, { params: { key: slot.key }, body: { body: value } }),
  );
  const Control = slot.kind === 'line' ? Input : Textarea;

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{slot.label}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(body);
          }}
        >
          <Field>
            <Label>{slot.label}</Label>
            <FieldDescription>
              {slot.help} {slot.written ? null : 'This is still the wording the site ships with.'}
            </FieldDescription>
            <Control
              value={body}
              onChange={(e: { target: { value: string } }) => {
                setBody(e.target.value);
              }}
            />
          </Field>
          <SaveOutcome mutation={save} done="Saved. The page shows it now." />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="secondary" disabled={save.isPending}>
              Save
            </Button>
            {slot.written ? (
              <Button
                type="button"
                variant="quiet"
                onClick={() => {
                  setBody(slot.fallback);
                  save.mutate('');
                }}
              >
                Go back to the shipped wording
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
