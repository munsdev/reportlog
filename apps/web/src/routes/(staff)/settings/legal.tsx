/**
 * The imprint and the privacy policy. Free text: what a notice must say is
 * decided by your jurisdiction, and this software does not pretend to know
 * which fields that means. It stores what you write and publishes it
 * unchanged.
 *
 * Until something is published the editor holds an outline, and says so
 * plainly, because saving it unchanged would publish the outline as your
 * notice.
 */
import { setLegalText } from '@reportlog/contracts';
import type { LegalKind, SiteEditor } from '@reportlog/contracts';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Field } from '@/components/ui/field.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Page } from '@/components/ui/page.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { call } from '@/lib/api.ts';
import { SaveOutcome, WithEditor, useSave, useUnsavedChanges } from './-editor.tsx';

export const Route = createFileRoute('/(staff)/settings/legal')({
  component: () => (
    <Page title="Legal notices" width="prose">
      <WithEditor>
        {(state) => (
          <div className="flex flex-col gap-6">
            {state.legal.map((l) => (
              <LegalEditor key={l.kind} entry={l} />
            ))}
          </div>
        )}
      </WithEditor>
    </Page>
  ),
});

const TITLES: Record<LegalKind, string> = { impressum: 'Imprint', privacy: 'Privacy policy' };

export function LegalEditor({ entry }: { entry: SiteEditor['legal'][number] }) {
  const [text, setText] = useState(entry.text);
  const save = useSave((value: string) =>
    call(setLegalText, { params: { kind: entry.kind }, body: { text: value } }),
  );
  const title = TITLES[entry.kind];
  useUnsavedChanges(`the ${title.toLowerCase()}`, text !== entry.text);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {entry.published ? (
          <Alert title={`Your ${title.toLowerCase()} is published.`} />
        ) : (
          <Alert title={`No ${title.toLowerCase()} is published.`}>
            The box holds an outline to start from, not a notice. Saving it as it stands would
            publish the outline. Replace every bracketed line first.
          </Alert>
        )}
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(text);
          }}
        >
          <Field>
            <Label>{title}</Label>
            <Textarea
              rows={18}
              className="font-mono text-sm"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
              }}
            />
          </Field>
          <SaveOutcome mutation={save} done="Saved." />
          <div className="flex flex-wrap gap-3">
            <Button type="submit" variant="secondary" disabled={save.isPending}>
              Publish
            </Button>
            {entry.published ? (
              <Button
                type="button"
                variant="quiet"
                onClick={() => {
                  // The box then holds the outline the server starts from
                  // again, so nothing reads as unsaved afterwards.
                  save.mutate('', {
                    onSuccess: (state) => {
                      setText(state.legal.find((l) => l.kind === entry.kind)?.text ?? '');
                    },
                  });
                }}
              >
                Take it down
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
