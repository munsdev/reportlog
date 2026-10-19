/**
 * One layer of file limits: the site's, or one logbook's.
 *
 * AN EMPTY BOX MEANS "USE THE ONE UNDERNEATH", and the number underneath is
 * its placeholder. A box holds only what THIS layer stores. Showing the
 * number in force instead invites an administrator to type all eight of
 * them, which silently freezes the site against every later change below.
 * Every box is sent on save, so emptying one is how a limit is cleared.
 *
 * KINDS NARROW, they never widen: a logbook can take fewer kinds than its
 * site, never more (the server intersects them).
 */
import { FILE_KINDS } from '@reportlog/contracts';
import type { FileKind, FileLimitLayers } from '@reportlog/contracts';
import { useState } from 'react';
import { Alert } from '../../../components/ui/alert.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Checkbox } from '../../../components/ui/checkbox.tsx';
import { Field, FieldDescription, FieldError } from '../../../components/ui/field.tsx';
import { Input } from '../../../components/ui/input.tsx';
import { Label } from '../../../components/ui/label.tsx';
import { RadioGroup, RadioOption } from '../../../components/ui/radio-group.tsx';
import { KIND_LABEL, LIMITS, boxProblem, fromBox, toBox } from './words.ts';
import type { NumberKey } from './words.ts';

export type Layer = 'site' | 'logbook';
export type LimitsBody = Partial<Record<NumberKey, number | null>> & { kinds?: FileKind[] | null };

const kindsList = (k: readonly FileKind[]) =>
  k.length ? k.map((x) => KIND_LABEL[x].toLowerCase()).join(', ') : 'none';

/** Where the number in force comes from, in a sentence. */
function source(row: FileLimitLayers[NumberKey], unit: 'mb' | 'n', suffix: string, mine: Layer) {
  const v = (n: number) => `${toBox(n, unit)} ${suffix}`;
  if (mine === 'logbook') {
    if (row.logbook !== null) return `Set on this logbook: ${v(row.logbook)}.`;
    if (row.site !== null) return `From the site: ${v(row.site)}.`;
    return `Not set anywhere, so ${v(row.shipped)} applies, the number this software comes with.`;
  }
  if (row.site !== null) return `Set here: ${v(row.site)}.`;
  return `Not set here, so ${v(row.shipped)} applies, the number this software comes with.`;
}

export function LimitsForm({
  layers,
  mine,
  onSave,
}: {
  layers: FileLimitLayers;
  mine: Layer;
  onSave: (body: LimitsBody) => Promise<unknown>;
}) {
  const own = (k: NumberKey) => (mine === 'logbook' ? layers[k].logbook : layers[k].site);
  const under = (k: NumberKey) =>
    mine === 'logbook' ? (layers[k].site ?? layers[k].shipped) : layers[k].shipped;
  const [boxes, setBoxes] = useState<Record<NumberKey, string>>(
    () =>
      Object.fromEntries(LIMITS.map((l) => [l.key, toBox(own(l.key), l.unit)])) as Record<
        NumberKey,
        string
      >,
  );
  const ownKinds = mine === 'logbook' ? layers.kinds.logbook : layers.kinds.site;
  const underKinds =
    mine === 'logbook' ? (layers.kinds.site ?? layers.kinds.shipped) : layers.kinds.shipped;
  const [choosing, setChoosing] = useState(ownKinds !== null);
  const [kinds, setKinds] = useState<FileKind[]>(ownKinds ?? underKinds);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);

  const problems = Object.fromEntries(
    LIMITS.map((l) => [l.key, boxProblem(boxes[l.key], l)]),
  ) as Record<NumberKey, string | null>;
  const anyProblem = Object.values(problems).some(Boolean);
  const setHere = LIMITS.filter((l) => own(l.key) !== null).length;

  const save = async (body: LimitsBody) => {
    setBusy(true);
    setOutcome(null);
    try {
      await onSave(body);
      setOutcome({ ok: true, text: 'Saved. The new limits apply to the next file anybody sends.' });
    } catch (e) {
      setOutcome({ ok: false, text: e instanceof Error ? e.message : 'That was not saved.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (anyProblem) return;
        const body: LimitsBody = {};
        for (const l of LIMITS) body[l.key] = fromBox(boxes[l.key], l.unit);
        body.kinds = choosing ? kinds : null;
        void save(body);
      }}
    >
      <p className="text-ink-alt">
        {setHere === 0
          ? mine === 'logbook'
            ? 'This logbook sets no limits of its own: it takes the site’s.'
            : 'Every limit is the one this software comes with. None is set here.'
          : `${String(setHere)} of ${String(LIMITS.length)} set here. An empty box uses the number shown in it.`}
      </p>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-semibold">Which kinds of file</legend>
        <RadioGroup
          value={choosing ? 'choose' : 'under'}
          onValueChange={(v) => {
            setChoosing(v === 'choose');
          }}
          aria-label="Which kinds of file"
        >
          <RadioOption
            value="under"
            label={mine === 'logbook' ? 'The same as the site' : 'Every kind'}
            hint={`Now: ${kindsList(underKinds)}.`}
          />
          <RadioOption
            value="choose"
            label="Only these"
            hint={mine === 'logbook' ? 'Never more than the site takes.' : undefined}
          />
        </RadioGroup>
        {choosing ? (
          <ul className="ml-9 flex flex-col gap-2" aria-label="Kinds taken">
            {FILE_KINDS.map((k) => {
              const id = `kind-${mine}-${k}`;
              const offAbove =
                mine === 'logbook' && !(layers.kinds.site ?? layers.kinds.shipped).includes(k);
              return (
                <li key={k} className="flex items-center gap-2">
                  <Checkbox
                    id={id}
                    checked={kinds.includes(k)}
                    onCheckedChange={(on) => {
                      setKinds((now) =>
                        on === true
                          ? FILE_KINDS.filter((x) => x === k || now.includes(x))
                          : now.filter((x) => x !== k),
                      );
                    }}
                  />
                  <Label htmlFor={id} className="font-normal">
                    {KIND_LABEL[k]}
                    {offAbove ? ' (the site does not take these, so this logbook cannot)' : ''}
                  </Label>
                </li>
              );
            })}
          </ul>
        ) : null}
        <p className="text-sm text-ink-alt">In force now: {kindsList(layers.kinds.effective)}.</p>
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        {LIMITS.map((l) => (
          <Field key={l.key}>
            <Label>
              {l.label} ({l.suffix})
            </Label>
            <FieldDescription>{source(layers[l.key], l.unit, l.suffix, mine)}</FieldDescription>
            <Input
              inputMode="numeric"
              value={boxes[l.key]}
              placeholder={toBox(under(l.key), l.unit)}
              onChange={(e) => {
                const v = e.target.value;
                setBoxes((b) => ({ ...b, [l.key]: v }));
              }}
            />
            <FieldError>{tried ? problems[l.key] : null}</FieldError>
          </Field>
        ))}
      </div>

      {outcome ? <Alert tone={outcome.ok ? 'confirmed' : 'serious'}>{outcome.text}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          Save the limits
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy || (setHere === 0 && ownKinds === null)}
          onClick={() => {
            // Clears the layer rather than writing today's numbers into it:
            // "stop choosing" is not "choose these numbers forever".
            const body: LimitsBody = { kinds: null };
            for (const l of LIMITS) body[l.key] = null;
            setBoxes(
              Object.fromEntries(LIMITS.map((l) => [l.key, ''])) as Record<NumberKey, string>,
            );
            setChoosing(false);
            void save(body);
          }}
        >
          {mine === 'logbook'
            ? 'Use the site’s limits for everything'
            : 'Clear every limit set here'}
        </Button>
      </div>
    </form>
  );
}
