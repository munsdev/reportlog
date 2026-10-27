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
import { Note } from '@/mockup/Note.tsx';
import { Btn } from '@/mockup/Btn.tsx';
import { CheckOption, RadioGroup, RadioOption } from '@/mockup/Choice.tsx';
import { Field, FieldDescription, FieldError, Input, Label } from '@/mockup/Field.tsx';
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
  onSaved,
  onCancel,
}: {
  layers: FileLimitLayers;
  mine: Layer;
  onSave: (body: LimitsBody) => Promise<unknown>;
  /** Inside a panel: told the sentence once saved, so the panel can close and say it. */
  onSaved?: ((text: string) => void) | undefined;
  /** Inside a panel: a Cancel beside Save. */
  onCancel?: (() => void) | undefined;
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
      const text = 'Saved. The new limits apply to the next file anybody sends.';
      setOutcome({ ok: true, text });
      onSaved?.(text);
    } catch (e) {
      setOutcome({ ok: false, text: e instanceof Error ? e.message : 'That was not saved.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="form-stack"
      style={{ maxWidth: 'none' }}
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
      <p className="muted">
        {setHere === 0
          ? mine === 'logbook'
            ? 'This logbook sets no limits of its own: it takes the site’s.'
            : 'Every limit is the one this software comes with. None is set here.'
          : `${String(setHere)} of ${String(LIMITS.length)} set here. An empty box uses the number shown in it.`}
      </p>

      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 10 }}>
        <legend className="lbl">Which kinds of file</legend>
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
          <ul
            className="choices"
            style={{ listStyle: 'none', padding: 0 }}
            aria-label="Kinds taken"
          >
            {FILE_KINDS.map((k) => {
              const id = `kind-${mine}-${k}`;
              const offAbove =
                mine === 'logbook' && !(layers.kinds.site ?? layers.kinds.shipped).includes(k);
              return (
                <li key={k}>
                  <CheckOption
                    id={id}
                    label={`${KIND_LABEL[k]}${offAbove ? ' (the site does not take these, so this logbook cannot)' : ''}`}
                    checked={kinds.includes(k)}
                    onCheckedChange={(on) => {
                      setKinds((now) =>
                        on === true
                          ? FILE_KINDS.filter((x) => x === k || now.includes(x))
                          : now.filter((x) => x !== k),
                      );
                    }}
                  />
                </li>
              );
            })}
          </ul>
        ) : null}
        <p className="muted">In force now: {kindsList(layers.kinds.effective)}.</p>
      </fieldset>

      <div className="grid2 even">
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

      {outcome ? <Note tone={outcome.ok ? 'done' : 'serious'}>{outcome.text}</Note> : null}
      <div className="acts">
        <Btn look="ink" sm flat type="submit" disabled={busy}>
          Save the limits
        </Btn>
        <Btn
          sm
          flat
          type="button"
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
        </Btn>
        {onCancel ? (
          <Btn look="ghost" sm flat type="button"  disabled={busy} onClick={onCancel}>
            Cancel
          </Btn>
        ) : null}
      </div>
    </form>
  );
}
