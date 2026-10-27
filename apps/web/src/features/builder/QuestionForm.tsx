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
import { Btn } from '@/mockup/Btn.tsx';
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
const EDITED = ['options', 'allowOther', 'scope', 'depth', 'earliest', 'latest', 'maxValues'];

/**
 * The words the approved filing cards use for the two kinds that are never
 * published, offered when one is chosen so an owner starts from them. Typed
 * over, they are the owner's own.
 */
const PRESETS: Record<string, { label: string; help: string }> = {
  private_text: {
    label: 'Want to tell us more?',
    help: 'In your own words. Leave out names of private people and anything that would identify you.',
  },
  private_link: {
    label: 'Got a link?',
    help: 'A post, photo or video about what happened. Up to three.',
  },
};

/**
 * A logbook cannot ask for free text that would be published as typed. The
 * only free text it may ask is an attached note or link, which is held apart
 * and never published (the server refuses the rest). Lists are unaffected:
 * they have their own form.
 */
const PLAIN_TEXT_KINDS: ReadonlySet<string> = new Set(['short_text', 'long_text', 'url', 'email']);

const PICKER_WORDS: Record<string, { label: string; help: string }> = {
  private_text: {
    label: 'Attached note (never published)',
    help: 'Several paragraphs in the reporter’s own words. Never published; a moderator can read it and it can be erased. Asked only if the logbook lets reporters attach a note or link.',
  },
  private_link: {
    label: 'Attached link (never published)',
    help: 'Up to three links to a post, photo or video. Never published; a moderator can read them and each can be erased. Asked only if the logbook lets reporters attach a note or link.',
  },
  place: {
    label: 'Place (pick from your list)',
    help: 'Somewhere, chosen from a list you supply.',
  },
};

/** The kinds that may carry an earliest and a latest answer (E4), and how each is typed. */
const LIMIT_INPUT: Record<string, { type: string; example: string }> = {
  date: { type: 'date', example: '2026-11-03' },
  time: { type: 'time', example: '07:00' },
  datetime: { type: 'text', example: '2026-11-03T07:00-05:00' },
};

/** A stored limit as its box shows it: a time without seconds, anything else as written. */
const limitShown = (kind: string, v: unknown): string =>
  typeof v !== 'string' ? '' : kind === 'time' ? v.slice(0, 5) : v;

export function QuestionForm({
  earlier,
  launched,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: Props) {
  const editing = Boolean(initial);
  const [kind, setKind] = useState(initial?.kind ?? 'private_text');
  const [label, setLabel] = useState(initial?.label ?? PRESETS.private_text?.label ?? '');
  const [help, setHelp] = useState(initial?.help ?? PRESETS.private_text?.help ?? '');
  const [required, setRequired] = useState(initial?.required ?? false);
  const [filterable, setFilterable] = useState(initial?.filterable ?? false);
  const [options, setOptions] = useState(optionsOf(initial).join('\n'));
  // A new place is always a closed list: a typed place would be published as
  // typed. One that already allows typing keeps doing so until it is replaced.
  const allowOther = initial?.kind === 'place' && initial.settings.allowOther !== false;
  const [scope, setScope] = useState(
    typeof initial?.settings.scope === 'string' ? initial.settings.scope : 'us',
  );
  const [depth, setDepth] = useState(initial?.settings.depth === 'county' ? 'county' : 'state');
  const [earliest, setEarliest] = useState(limitShown(kind, initial?.settings.earliest));
  const [latest, setLatest] = useState(limitShown(kind, initial?.settings.latest));
  const [whenField, setWhenField] = useState(initial?.shown_when?.field ?? '');
  const [whenValues, setWhenValues] = useState<string[]>(initial?.shown_when?.in ?? []);
  const [linkCount, setLinkCount] = useState(
    typeof initial?.settings.maxValues === 'number' ? String(initial.settings.maxValues) : '3',
  );
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);

  const type = fieldType(kind);
  const isFile = kind === FILE_TYPE;
  const limitInput = LIMIT_INPUT[kind];
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
    if (kind === 'private_link') return { ...kept, maxValues: Number(linkCount) };
    // Depth only as `county`: an absent depth IS state, and settings are sealed.
    if (kind === LOCATION_TYPE) {
      return { ...kept, scope, ...(scope === 'us' && depth === 'county' ? { depth } : {}) };
    }
    // ONLY WHEN WRITTEN: settings are sealed, and a question without limits
    // must hash as it always did.
    if (limitInput) {
      const limits = {
        ...kept,
        ...(earliest.trim() ? { earliest: earliest.trim() } : {}),
        ...(latest.trim() ? { latest: latest.trim() } : {}),
      };
      return Object.keys(limits).length ? limits : undefined;
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
      className="form-stack"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {!editing && (
        <Field label="Kind of question" help={PICKER_WORDS[kind]?.help ?? type?.description}>
          {(p) => (
            <Select
              {...p}
              value={kind}
              onChange={(e) => {
                const next = e.target.value;
                setKind(next);
                // Start from the approved words, but never over the owner's own.
                const was = PRESETS[kind];
                const now = PRESETS[next];
                if (now && (label.trim() === '' || label === was?.label)) setLabel(now.label);
                if (now && (help.trim() === '' || help === was?.help)) setHelp(now.help);
              }}
            >
              {FIELD_TYPES.filter((t) => !PLAIN_TEXT_KINDS.has(t.id)).map((t) => (
                <option key={t.id} value={t.id}>
                  {PICKER_WORDS[t.id]?.label ?? t.label}
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

      {kind === 'private_link' && (
        <Field
          label="How many links a reporter can give"
          help="Never published. Each is checked on the Links page, like the tip line's."
        >
          {(p) => (
            <Select
              {...p}
              value={linkCount}
              onChange={(e) => {
                setLinkCount(e.target.value);
              }}
            >
              <option value="1">One</option>
              <option value="2">Up to two</option>
              <option value="3">Up to three</option>
            </Select>
          )}
        </Field>
      )}

      {(kind === 'private_text' || kind === 'private_link') && (
        <p className="muted">
          Reporters are asked this only if “Reporters may attach a note or link” is on for the
          logbook. One who writes something or gives a link is asked for an email address and
          whether vetted journalists may read it. After launch this can only be added as an optional
          question.
        </p>
      )}

      {LIST_KINDS.has(kind) && !hasSets && (
        <Field
          label="Choices, one per line"
          help={
            kind === 'place'
              ? 'Reporters pick from this list. Typed places are not allowed on a logbook, because they would be published as typed.'
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

      {limitInput && (
        <fieldset className="panel quiet">
          <legend className="lbl">Earliest and latest answer (optional)</legend>
          <p className="muted">
            An answer outside these is refused, and the form offers nothing outside them. Leave
            either empty for no limit that way.
            {kind === 'datetime'
              ? ` Write a date and time with its offset from UTC, for example ${limitInput.example}.`
              : ''}{' '}
            Like the rest of the question, they cannot be changed after launch.
          </p>
          <Field label="Earliest">
            {(p) => (
              <TextInput
                {...p}
                type={limitInput.type}
                value={earliest}
                placeholder={limitInput.example}
                onChange={(e) => {
                  setEarliest(e.target.value);
                }}
              />
            )}
          </Field>
          <Field label="Latest">
            {(p) => (
              <TextInput
                {...p}
                type={limitInput.type}
                value={latest}
                placeholder={limitInput.example}
                onChange={(e) => {
                  setLatest(e.target.value);
                }}
              />
            )}
          </Field>
        </fieldset>
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
        onCheckedChange={(on) => {
          setRequired(on);
        }}
      />
      {canFilter(kind) && (
        <Check
          label="Offer it as a filter on the board"
          checked={filterable}
          onCheckedChange={(on) => {
            setFilterable(on);
          }}
        />
      )}

      {/* An upload question cannot carry a condition, and with nothing to
          depend on yet an empty picker would read as broken. */}
      {!isFile && targets.length > 0 && (
        <fieldset className="panel quiet">
          <legend className="lbl">When it is asked</legend>
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
            <div role="group" aria-label="The answers that bring it up" className="choices">
              <p className="muted">Asked when the answer is any of these:</p>
              {values.map((v) => (
                <Check
                  key={v}
                  label={v === YES ? 'Yes' : v === 'no' ? 'No' : v}
                  checked={whenValues.includes(v)}
                  onCheckedChange={(on) => {
                    setWhenValues((now) => (on ? [...now, v] : now.filter((x) => x !== v)));
                  }}
                />
              ))}
            </div>
          )}
        </fieldset>
      )}

      <Problem error={error} />
      <div className="acts">
        <Btn sm flat type="submit"  disabled={busy}>
          {submitLabel}
        </Btn>
        {onCancel && (
          <Btn look="ghost" sm flat type="button"  onClick={onCancel}>
            Cancel
          </Btn>
        )}
      </div>
    </form>
  );
}
