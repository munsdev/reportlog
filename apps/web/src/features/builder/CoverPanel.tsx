/**
 * The cover page panel (decision 78), shared by a logbook and a list: the
 * words on the first card and its call to action. Never sealed, so it can
 * change at any time, even after a logbook has launched. A part left empty
 * means the default.
 */
import type { Cover } from '@reportlog/contracts';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/button.tsx';
import { Field, Panel, Problem, Select, TextArea, TextInput } from './controls.tsx';

type Mode = 'site' | 'hide' | 'custom';

export function CoverPanel({
  kind,
  cover,
  save,
}: {
  kind: 'logbook' | 'list';
  cover: Cover | null | undefined;
  save: (cover: Cover | null) => Promise<unknown>;
}) {
  const [eyebrow, setEyebrow] = useState(cover?.eyebrow ?? '');
  const [intro, setIntro] = useState(cover?.intro ?? '');
  const [button, setButton] = useState(cover?.button_label ?? '');
  const [mode, setMode] = useState<Mode>(cover?.cta?.mode ?? (kind === 'logbook' ? 'site' : 'hide'));
  const [heading, setHeading] = useState(cover?.cta?.heading ?? '');
  const [body, setBody] = useState(cover?.cta?.body ?? '');
  const [ctaLabel, setCtaLabel] = useState(cover?.cta?.button_label ?? '');
  const [ctaUrl, setCtaUrl] = useState(cover?.cta?.button_url ?? '');
  const mutation = useMutation({
    mutationFn: () => {
      const out: Cover = {
        ...(eyebrow.trim() ? { eyebrow: eyebrow.trim() } : {}),
        ...(intro.trim() ? { intro: intro.trim() } : {}),
        ...(button.trim() ? { button_label: button.trim() } : {}),
        cta: {
          mode,
          ...(mode === 'custom' && heading.trim() ? { heading: heading.trim() } : {}),
          ...(mode === 'custom' && body.trim() ? { body: body.trim() } : {}),
          ...(mode === 'custom' && ctaLabel.trim() ? { button_label: ctaLabel.trim() } : {}),
          ...(mode === 'custom' && ctaUrl.trim() ? { button_url: ctaUrl.trim() } : {}),
        },
      };
      return save(out);
    },
  });
  const set = (f: (v: string) => void) => (e: { target: { value: string } }) => {
    f(e.target.value);
  };
  return (
    <Panel title="Cover page">
      <p className="text-sm text-muted">
        The first card people see, before the first question. None of this is part of the
        questions, so it can change at any time. Leave a box empty to use the usual wording.
      </p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        <Field
          label="Small heading above the title (optional)"
          help={
            kind === 'logbook'
              ? 'Left empty, it says “File a report”.'
              : 'Left empty, there is none.'
          }
        >
          {(p) => <TextInput {...p} value={eyebrow} maxLength={60} onChange={set(setEyebrow)} />}
        </Field>
        <Field
          label="Introduction (optional)"
          help="A few paragraphs under the description. A blank line starts a new paragraph."
        >
          {(p) => <TextArea {...p} value={intro} maxLength={4000} onChange={set(setIntro)} />}
        </Field>
        <Field label="Start button wording (optional)" help="Left empty, it says “Start”.">
          {(p) => <TextInput {...p} value={button} maxLength={40} onChange={set(setButton)} />}
        </Field>
        <Field
          label="Call to action box"
          help={
            mode === 'site'
              ? 'Shows the box set for the whole site (Settings, Words). If the site has none, nothing shows.'
              : mode === 'hide'
                ? 'No box on this cover.'
                : 'A box of your own on this cover.'
          }
        >
          {(p) => (
            <Select
              {...p}
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as Mode);
              }}
            >
              <option value="site">Site default</option>
              <option value="hide">Hidden</option>
              <option value="custom">Custom</option>
            </Select>
          )}
        </Field>
        {mode === 'custom' ? (
          <>
            <Field label="Box heading" help="Left empty, the site’s heading is used.">
              {(p) => <TextInput {...p} value={heading} maxLength={80} onChange={set(setHeading)} />}
            </Field>
            <Field label="Box text" help="Left empty, the box does not show.">
              {(p) => <TextArea {...p} value={body} maxLength={1000} onChange={set(setBody)} />}
            </Field>
            <Field label="Box button wording (optional)">
              {(p) => (
                <TextInput {...p} value={ctaLabel} maxLength={40} onChange={set(setCtaLabel)} />
              )}
            </Field>
            <Field
              label="Box button link (optional)"
              help="A web address (https://…) or a page on this site (/about). The button needs both wording and a link."
            >
              {(p) => <TextInput {...p} value={ctaUrl} maxLength={500} onChange={set(setCtaUrl)} />}
            </Field>
          </>
        ) : null}
        <Problem error={mutation.error} />
        <Button type="submit" variant="secondary" disabled={mutation.isPending}>
          Save cover page
        </Button>
        {mutation.isSuccess && <p role="status">Saved.</p>}
      </form>
    </Panel>
  );
}
