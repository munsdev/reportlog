/**
 * Adding a question, or changing one while the logbook is a draft.
 *
 * Nothing here knows what a date or a place is FOR. It knows the types the
 * software offers (@reportlog/fields) and the operator decides the rest. The
 * server decides what is allowed; this form keeps out of the menu what it
 * would refuse, so an operator rarely has to meet a refusal at all.
 */
import type { Condition, OptionInput, Question, QuestionSettingsInput } from '@reportlog/contracts';
import {
  CONDITIONABLE_KINDS,
  FIELD_TYPES,
  FILE_TYPE,
  LOCATION_TYPE,
  YES,
  canFilter,
  fieldType,
  matchableValues,
  optionArray,
} from '@reportlog/fields';
import { useState } from 'react';
import { Button } from '../../components/ui/button.tsx';
import { Check, Field, Problem, Select, TextArea, TextInput } from './controls.tsx';

const LIST_KINDS: ReadonlySet<string> = new Set(['choice_one', 'choice_many', 'place']);

/** What can be said about a question. Its kind is passed beside it: it is fixed once a question exists. */
export interface QuestionBody {
  label: string;
  help: string | null;
  required: boolean;
  filterable: boolean;
  settings?: QuestionSettingsInput;
  shown_when?: Condition | null;
}

interface Props {
  /** The questions BEFORE this one: a condition can only look back. */
  earlier: readonly Question[];
  launched: boolean;
  initial?: Question;
  submitLabel: string;
  onSubmit: (body: QuestionBody, kind: string) => Promise<unknown>;
  onCancel?: () => void;
}

/**
 * The choices as the box shows them: one per line, and a choice with a code
 * as `code | label`. A plain line is its own code and label, as before codes.
 */
const optionsOf = (q: Question | undefined): string[] =>
  optionArray(q?.settings.options).map((o) =>
    typeof o === 'string' ? o : `${o.code} | ${o.label}`,
  );

/** The box back into choices. A line with a `|` is a code and its label. */
function parseOptions(text: string): OptionInput[] {
  return text
    .split('\n')
    .map((o) => o.trim())
    .filter(Boolean)
    .map((o) => {
      const at = o.indexOf('|');
      return at < 0 ? o : { code: o.slice(0, at).trim(), label: o.slice(at + 1).trim() };
    });
}

/** The settings this form edits; anything else a question carries is kept as it is. */
const EDITED = ['options', 'allowOther', 'scope', 'depth'];

export function QuestionForm({
  earlier,
  launched,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: Props) {
  const editing = Boolean(initial);
  const [kind, setKind] = useState(initial?.kind ?? 'short_text');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [help, setHelp] = useState(initial?.help ?? '');
  const [required, setRequired] = useState(initial?.required ?? false);
  const [filterable, setFilterable] = useState(initial?.filterable ?? false);
  const [options, setOptions] = useState(optionsOf(initial).join('\n'));
  const [allowOther, setAllowOther] = useState(initial?.settings.allowOther !== false);
  const [scope, setScope] = useState(
    typeof initial?.settings.scope === 'string' ? initial.settings.scope : 'us',
  );
  const [depth, setDepth] = useState(initial?.settings.depth === 'county' ? 'county' : 'state');
  const [whenField, setWhenField] = useState(initial?.shown_when?.field ?? '');
  const [whenValues, setWhenValues] = useState<string[]>(initial?.shown_when?.in ?? []);
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);

  const type = fieldType(kind);
  const isFile = kind === FILE_TYPE;
  // Only kinds whose answers come from a fixed list can decide another
  // question; `place` lets a reporter type anything, so it cannot.
  const targets = earlier.filter((f) => CONDITIONABLE_KINDS.has(f.kind));
  const target = targets.find((f) => f.key === whenField);
  const values = matchableValues(target);

  // WHAT THIS FORM DOES NOT EDIT IS KEPT: option sets, help that depends on
  // an answer, a shared card, how a place is written. A save that dropped them
  // would quietly change what the question asks.
  const kept = Object.fromEntries(
    Object.entries(initial?.settings ?? {}).filter(([k]) => !EDITED.includes(k)),
  ) as QuestionSettingsInput;
  const hasSets = Array.isArray(initial?.settings.option_sets);

  function settings(): QuestionSettingsInput | undefined {
    const list = parseOptions(options);
    if (kind === 'choice_one' || kind === 'choice_many')
      return hasSets ? kept : { ...kept, options: list };
    if (kind === 'place') return { ...kept, options: list, allowOther };
    // Depth only as `county`: an absent depth IS state, and settings are sealed.
    if (kind === LOCATION_TYPE) {
      return { ...kept, scope, ...(scope === 'us' && depth === 'county' ? { depth } : {}) };
    }
    return Object.keys(kept).length ? kept : undefined;
  }

  function condition(): Condition | null | undefined {
    if (whenField && whenValues.length) return { field: whenField, in: whenValues };
    // On an edit, "always" has to be said, or an old condition would stay.
    return editing ? null : undefined;
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const s = settings();
      const c = condition();
      await onSubmit(
        {
          label,
          help: help.trim() ? help : null,
          required: required && !isFile,
          filterable: filterable && canFilter(kind),
          ...(s ? { settings: s } : {}),
          ...(c === undefined ? {} : { shown_when: c }),
        },
        kind,
      );
      if (!editing) {
        setLabel('');
        setHelp('');
        setRequired(false);
        setFilterable(false);
        setOptions('');
        setWhenField('');
        setWhenValues([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e : new Error('That did not work.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {!editing && (
        <Field label="Kind of question" help={type?.description}>
          {(p) => (
            <Select
              {...p}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
              }}
            >
              {FIELD_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}

      <Field label="The question, as the reporter will read it">
        {(p) => (
          <TextInput
            {...p}
            value={label}
            maxLength={160}
            required
            onChange={(e) => {
              setLabel(e.target.value);
            }}
          />
        )}
      </Field>

      <Field label="Help under the question (optional)">
        {(p) => (
          <TextInput
            {...p}
            value={help}
            maxLength={1000}
            onChange={(e) => {
              setHelp(e.target.value);
            }}
          />
        )}
      </Field>

      {LIST_KINDS.has(kind) && !hasSets && (
        <Field
          label="Choices, one per line"
          help={
            kind === 'place'
              ? 'Leave empty to let people type any place.'
              : 'To keep a code apart from the words, write code | words, for example fine | It went fine. The code is what is sealed; the words can be changed after launch.'
          }
        >
          {(p) => (
            <TextArea
              {...p}
              value={options}
              onChange={(e) => {
                setOptions(e.target.value);
              }}
            />
          )}
        </Field>
      )}
      {kind === 'place' && (
        <Check
          label="Let people type a place that is not on the list"
          checked={allowOther}
          onChange={(e) => {
            setAllowOther(e.target.checked);
          }}
        />
      )}
      {kind === LOCATION_TYPE && (
        <Field label="Which places it offers">
          {(p) => (
            <Select
              {...p}
              value={scope}
              onChange={(e) => {
                setScope(e.target.value);
              }}
            >
              <option value="us">A US state, DC or territory</option>
              <option value="world">A country</option>
              <option value="both">Either</option>
            </Select>
          )}
        </Field>
      )}
      {kind === LOCATION_TYPE && scope === 'us' && (
        <Field
          label="How exact"
          help="With the county, a reporter picks a state and then, if they know it, the county. Heat maps still count by state."
        >
          {(p) => (
            <Select
              {...p}
              value={depth}
              onChange={(e) => {
                setDepth(e.target.value);
              }}
            >
              <option value="state">The state</option>
              <option value="county">The state, then the county</option>
            </Select>
          )}
        </Field>
      )}

      <Check
        label="An answer is needed"
        checked={required && !isFile && !launched}
        disabled={launched || isFile}
        help={
          launched
            ? 'A question added after launch has to be optional: reports already filed never answered it.'
            : isFile
              ? 'An upload question cannot be compulsory: it seals no answer of its own.'
              : undefined
        }
        onChange={(e) => {
          setRequired(e.target.checked);
        }}
      />
      {canFilter(kind) && (
        <Check
          label="Offer it as a filter on the board"
          checked={filterable}
          onChange={(e) => {
            setFilterable(e.target.checked);
          }}
        />
      )}

      {/* An upload question cannot carry a condition, and with nothing to
          depend on yet an empty picker would read as broken. */}
      {!isFile && targets.length > 0 && (
        <fieldset className="space-y-2 rounded-card border border-line p-3">
          <legend className="px-1 font-semibold">When it is asked</legend>
          <Field label="Ask it">
            {(p) => (
              <Select
                {...p}
                value={whenField}
                onChange={(e) => {
                  setWhenField(e.target.value);
                  setWhenValues([]);
                }}
              >
                <option value="">Always: ask everybody</option>
                {targets.map((f) => (
                  <option key={f.key} value={f.key}>
                    Only depending on “{f.label}”
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {target && (
            <div role="group" aria-label="The answers that bring it up" className="space-y-1">
              <p className="text-sm text-muted">Asked when the answer is any of these:</p>
              {values.map((v) => (
                <Check
                  key={v}
                  label={v === YES ? 'Yes' : v === 'no' ? 'No' : v}
                  checked={whenValues.includes(v)}
                  onChange={(e) => {
                    setWhenValues((now) =>
                      e.target.checked ? [...now, v] : now.filter((x) => x !== v),
                    );
                  }}
                />
              ))}
            </div>
          )}
        </fieldset>
      )}

      <Problem error={error} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="secondary" disabled={busy}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
