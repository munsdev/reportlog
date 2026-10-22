/**
 * Choosing a look: a card for each named look, then the two parts on their
 * own for anybody who wants a pair nobody named. Shared by the Look screen
 * and the setup wizard. Choosing changes the value and nothing else; what
 * the caller does with it (preview it, save it) is the caller's.
 *
 * Each card's strip is painted by its own palette (`data-palette` on the
 * strip), so the stylesheet draws it, never a colour computed here. A look
 * from an installed pack is painted the same way: its pack's stylesheet is
 * linked on every page, and its card says which pack it came with.
 */
import type { Look } from '@reportlog/contracts';
import { useId } from 'react';
import { Chip } from '@/components/ui/chip.tsx';
import { Field, FieldDescription } from '@/components/ui/field.tsx';
import { Label } from '@/components/ui/label.tsx';
import { RadioGroup, RadioOption } from '@/components/ui/radio-group.tsx';
import { Select } from '@/components/ui/select.tsx';
import { BUILT_IN_CATALOGUE, namedLookFor, sameLook } from './looks.ts';
import type { LookCatalogue } from './looks.ts';

function Strip({ palette, theme }: { palette: string; theme: string }) {
  return (
    <span
      data-palette={palette}
      data-theme={theme}
      aria-hidden="true"
      className="flex h-7 overflow-hidden rounded-control border border-ink-alt"
    >
      <span className="flex-[2] bg-deep" />
      <span className="flex-[3] bg-paper" />
      <span className="flex-1 bg-action" />
      <span className="flex-1 bg-surface" />
    </span>
  );
}

export interface LookChooserProps {
  value: Look;
  onChange: (look: Look) => void;
  /** What the site wears now: its card says "On the site". */
  current?: Look | undefined;
  /** What may be chosen: the built-in pack unless the caller adds installed ones. */
  catalogue?: LookCatalogue | undefined;
}

export function LookChooser({
  value,
  onChange,
  current,
  catalogue = BUILT_IN_CATALOGUE,
}: LookChooserProps) {
  const headingId = useId();
  const chosen = namedLookFor(value, catalogue);
  const { looks: LOOKS, palettes: PALETTES, themes: THEMES } = catalogue;
  const palettes = PALETTES.length;
  const themes = THEMES.length;
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby={headingId} className="flex flex-col gap-3">
        <h2 id={headingId} className="font-display text-xl font-bold">
          Looks
        </h2>
        <RadioGroup
          aria-labelledby={headingId}
          value={chosen?.id ?? ''}
          onValueChange={(id) => {
            const look = LOOKS.find((l) => l.id === id);
            if (look) onChange({ palette: look.palette, theme: look.theme });
          }}
          className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        >
          {LOOKS.map((l) => {
            const onSite = current ? sameLook(current, l) : false;
            return (
              <RadioOption
                key={l.id}
                value={l.id}
                className="items-start px-3"
                label={
                  <span className="flex flex-col gap-2">
                    <Strip palette={l.palette} theme={l.theme} />
                    <span className="flex flex-wrap items-center gap-2">
                      <span>{l.label}</span>
                      {onSite ? <Chip tone="tag">On the site</Chip> : null}
                    </span>
                    {l.pack ? <span className="text-sm text-ink-alt">From {l.pack}</span> : null}
                  </span>
                }
              />
            );
          })}
        </RadioGroup>
      </section>

      <section className="flex flex-col gap-3 border-t border-ink-alt pt-4">
        <h2 className="font-display text-xl font-bold">Or choose the two parts yourself</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <Label>Palette, the colours</Label>
            <Select
              value={value.palette}
              onChange={(e) => {
                onChange({ ...value, palette: e.target.value });
              }}
            >
              {PALETTES.map((p) => (
                <option key={p.id} value={p.id} title={p.description}>
                  {p.label} · {p.dark ? 'dark' : 'light'}
                </option>
              ))}
            </Select>
            <FieldDescription>
              {PALETTES.find((p) => p.id === value.palette)?.description ??
                `${String(palettes)} palettes.`}{' '}
              Every one passes the contrast check.
            </FieldDescription>
          </Field>
          <Field>
            <Label>Theme, the type and shapes</Label>
            <Select
              value={value.theme}
              onChange={(e) => {
                onChange({ ...value, theme: e.target.value });
              }}
            >
              {THEMES.map((t) => (
                <option key={t.id} value={t.id} title={t.description}>
                  {t.label}
                </option>
              ))}
            </Select>
            <FieldDescription>
              {THEMES.find((t) => t.id === value.theme)?.description ?? `${String(themes)} themes.`}{' '}
              Any theme works with any palette.
            </FieldDescription>
          </Field>
        </div>
      </section>
    </div>
  );
}
