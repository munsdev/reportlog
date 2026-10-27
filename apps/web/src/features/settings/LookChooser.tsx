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
import { St } from '@/mockup/St.tsx';
import { Field, FieldDescription } from '@/mockup/FieldWired.tsx';
import { Label } from '@/mockup/FieldWired.tsx';
import { RadioGroup, RadioOption } from '@/mockup/ChoicesWired.tsx';
import { Select } from '@/mockup/FieldWired.tsx';
import { BUILT_IN_CATALOGUE, namedLookFor, sameLook } from './looks.ts';
import type { LookCatalogue } from './looks.ts';

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
  const chosen = namedLookFor(value, catalogue);
  const { looks: LOOKS, palettes: PALETTES, themes: THEMES } = catalogue;
  const palettes = PALETTES.length;
  const themes = THEMES.length;
  const choose = (id: string) => {
    const look = LOOKS.find((l) => l.id === id);
    if (look) onChange({ palette: look.palette, theme: look.theme });
  };
  const palette = PALETTES.find((p) => p.id === value.palette);
  const theme = THEMES.find((t) => t.id === value.theme);

  return (
    <>
      <div className="opt-grid">
        <Field>
          <Label>Palette</Label>
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
            {palette?.description ?? `${String(palettes)} palettes.`} Every one passes the contrast
            check.
          </FieldDescription>
        </Field>
        <Field>
          <Label>Theme</Label>
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
            {theme?.description ?? `${String(themes)} themes.`} Any theme works with any palette.
          </FieldDescription>
        </Field>
      </div>
      <RadioGroup aria-label="Named looks" value={chosen?.id ?? ''} onValueChange={choose}>
        {LOOKS.map((l) => {
          const onSite = current ? sameLook(current, l) : false;
          return (
            <RadioOption
              key={l.id}
              value={l.id}
              label={
                <>
                  {l.label} {onSite ? <St tone="tag">On the site</St> : null}
                </>
              }
              hint={l.pack ? `From ${l.pack}` : undefined}
            />
          );
        })}
      </RadioGroup>
    </>
  );
}
