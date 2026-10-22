/**
 * The imprint and the privacy policy. Free text: what a notice must say is
 * decided by your jurisdiction, and this software does not pretend to know
 * which fields that means. It stores what you write and publishes it
 * unchanged. The terms of use are not a legal notice here: they are page
 * wording, on the Wording page.
 *
 * Each is a setting panel whose closed state says "Written" or "Outline
 * only" and shows the first lines. Until something is published the editor
 * holds an outline, and says so plainly, because saving it unchanged would
 * publish the outline as your notice.
 */
import { setLegalText } from '@reportlog/contracts';
import type { SiteEditor } from '@reportlog/contracts';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Field, FieldDescription, FieldError } from '@/components/ui/field.tsx';
import { Label } from '@/components/ui/label.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { useSettingPanels } from '@/components/ui/setting-panel.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { call } from '@/lib/api.ts';
import { GuardedPanel, SettingsFrame } from '../../../features/settings/panels.tsx';
import { LEGAL_TITLES, firstLines } from '../../../features/settings/wording.tsx';
import { WithEditor, useSave } from './-editor.tsx';

export const Route = createFileRoute('/(staff)/settings/legal')({
  component: () => (
    <SettingsFrame>
      <StaffPage
        title="Legal notices"
        width="prose"
        lede="Your imprint and privacy policy, published exactly as you write them."
      >
        <WithEditor>
          {(state) => (
            <div className="flex flex-col gap-6">
              {state.legal.map((l) => (
                <LegalEditor key={l.kind} entry={l} />
              ))}
            </div>
          )}
        </WithEditor>
      </StaffPage>
    </SettingsFrame>
  ),
});

export function LegalEditor({ entry }: { entry: SiteEditor['legal'][number] }) {
  const [text, setText] = useState(entry.text);
  const toast = useToast();
  const panels = useSettingPanels();
  const save = useSave((value: string) =>
    call(setLegalText, { params: { kind: entry.kind }, body: { text: value } }),
  );
  const title = LEGAL_TITLES[entry.kind];
  const resetSave = save.reset;
  const cancel = useCallback(() => {
    setText(entry.text);
    resetSave();
  }, [entry.text, resetSave]);

  /** Save, and leave the box holding what the server now holds. */
  const write = async (value: string) => {
    const state = await save.mutateAsync(value);
    setText(state.legal.find((l) => l.kind === entry.kind)?.text ?? value);
    toast.show(
      value.trim()
        ? `Your ${title.toLowerCase()} is published.`
        : `Your ${title.toLowerCase()} is taken down.`,
    );
    return true;
  };

  return (
    <GuardedPanel
      id={entry.kind}
      title={title}
      summary={[
        { key: 'Status', value: entry.published ? 'Written' : 'Outline only, not published' },
        ...(entry.published ? [{ key: 'Begins', value: firstLines(entry.text) }] : []),
      ]}
      dirty={text !== entry.text}
      onCancel={cancel}
      onSave={() => write(text)}
    >
      {entry.published ? null : (
        <Alert title={`No ${title.toLowerCase()} is published.`}>
          The box holds an outline to start from, not a notice. Saving it as it stands would publish
          the outline. Replace every bracketed line first.
        </Alert>
      )}
      <Field>
        <Label>{title}</Label>
        <FieldDescription>Saving publishes it, exactly as written here.</FieldDescription>
        <Textarea
          rows={18}
          className="font-mono text-sm"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
        <FieldError>{save.isError ? save.error.message : null}</FieldError>
      </Field>
      {entry.published ? (
        <div>
          <Button
            type="button"
            variant="quiet"
            onClick={() => {
              // The box then holds the outline the server starts from
              // again, so nothing reads as unsaved afterwards.
              write('').then(
                () => {
                  panels.closeNow();
                },
                () => undefined,
              );
            }}
          >
            Take it down
          </Button>
        </div>
      ) : null}
    </GuardedPanel>
  );
}
