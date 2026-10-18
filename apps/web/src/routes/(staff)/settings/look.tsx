/**
 * Choosing the palette and the theme. PALETTE owns every colour; THEME owns
 * type, corners and width and sets no colour, so any pair works.
 *
 * Choosing does nothing until Save: the page an administrator is working on
 * does not repaint under them. Each palette shows its own colours in a
 * swatch, painted by the same stylesheet the site uses, never by a colour
 * this screen computed.
 */
import { PALETTES, THEMES, setLook } from '@reportlog/contracts';
import type { Look, SiteEditor } from '@reportlog/contracts';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Field } from '@/components/ui/field.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Page } from '@/components/ui/page.tsx';
import { RadioGroup, RadioOption } from '@/components/ui/radio-group.tsx';
import { call } from '@/lib/api.ts';
import { SaveOutcome, WithEditor, useSave } from './-editor.tsx';

export const Route = createFileRoute('/(staff)/settings/look')({
  component: () => (
    <Page title="Look" width="wide">
      <WithEditor>{(state) => <LookForm state={state} />}</WithEditor>
    </Page>
  ),
});

function Swatch({ palette }: { palette: string }) {
  return (
    <span
      data-palette={palette}
      aria-hidden="true"
      className="flex h-10 w-28 shrink-0 overflow-hidden rounded-control border border-line"
    >
      <span className="flex flex-1 items-center justify-center bg-paper font-bold text-ink">
        Aa
      </span>
      <span className="w-6 bg-deep" />
      <span className="w-6 bg-action" />
    </span>
  );
}

export function LookForm({ state }: { state: SiteEditor }) {
  const [look, setLookState] = useState<Look>(state.look);
  const save = useSave((value: Look) => call(setLook, { body: value }));
  const changed = look.palette !== state.look.palette || look.theme !== state.look.theme;

  return (
    <form
      className="flex flex-col gap-8"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(look);
      }}
    >
      <Field>
        <Label>Palette</Label>
        <RadioGroup
          value={look.palette}
          onValueChange={(v) => {
            setLookState({ ...look, palette: v as Look['palette'] });
          }}
          className="grid gap-3 sm:grid-cols-2"
        >
          {PALETTES.map((p) => (
            <div key={p.id} className="flex items-start gap-3">
              <RadioOption
                value={p.id}
                label={p.label}
                hint={`${p.description}${p.dark ? ' Dark.' : ''}`}
              />
              <Swatch palette={p.id} />
            </div>
          ))}
        </RadioGroup>
      </Field>

      <Field>
        <Label>Theme</Label>
        <RadioGroup
          value={look.theme}
          onValueChange={(v) => {
            setLookState({ ...look, theme: v as Look['theme'] });
          }}
        >
          {THEMES.map((t) => (
            <RadioOption key={t.id} value={t.id} label={t.label} hint={t.description} />
          ))}
        </RadioGroup>
      </Field>

      <SaveOutcome mutation={save} done="The new look is live." />
      <div>
        <Button type="submit" disabled={!changed || save.isPending}>
          Save the look
        </Button>
      </div>
    </form>
  );
}
