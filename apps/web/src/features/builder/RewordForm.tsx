/**
 * Rewording a question of a launched logbook (ruling 48).
 *
 * WORDS ONLY. The question, its help, the card's own question, the help shown
 * for an answer, and the label of every choice that has a code. Each code is
 * shown beside its label and cannot be typed over: the code is what sealed
 * answers hold. A choice written as plain text is its own code, so it is not
 * offered here at all. The server and the database refuse anything else
 * whatever this form sends; this form simply does not offer it.
 *
 * A rewording is a new version of the form. Reports already filed keep the
 * version they were asked.
 */
import type { OptionInput, Question, QuestionSettingsInput } from '@reportlog/contracts';
import { describeCondition, optionArray, optionSetsOf } from '@reportlog/fields';
import type { FieldDefinition } from '@reportlog/fields';
import { useState } from 'react';
import { Btn } from '@/mockup/StaffBtn.tsx';
import { Field, Problem, TextInput } from './controls.tsx';

interface Props {
  question: Question;
  earlier: readonly FieldDefinition[];
  onSubmit: (body: {
    label: string;
    help: string | null;
    settings: QuestionSettingsInput;
  }) => Promise<unknown>;
  onCancel: () => void;
}

type Labels = Record<string, string>;

const labelsOf = (list: unknown): Labels =>
  Object.fromEntries(
    optionArray(list).flatMap((o) => (typeof o === 'string' ? [] : [[o.code, o.label]])),
  );

const relabel = (list: unknown, labels: Labels): OptionInput[] =>
  optionArray(list).map((o) =>
    typeof o === 'string' ? o : { code: o.code, label: labels[o.code] ?? o.label },
  );

export function RewordForm({ question: q, earlier, onSubmit, onCancel }: Props) {
  const s = q.settings as QuestionSettingsInput;
  const sets = optionSetsOf(s);
  const [label, setLabel] = useState(q.label);
  const [help, setHelp] = useState(q.help ?? '');
  const [cardQuestion, setCardQuestion] = useState(s.card_question ?? '');
  const [options, setOptions] = useState<Labels>(labelsOf(s.options));
  const [setLabels, setSetLabels] = useState<Labels[]>(sets.map((set) => labelsOf(set.options)));
  const [helps, setHelps] = useState<string[]>((s.help_when ?? []).map((h) => h.help));
  const [error, setError] = useState<Error | null>(null);
  const [busy, setBusy] = useState(false);

  const settings = (): QuestionSettingsInput => ({
    ...s,
    ...(s.card_question !== undefined ? { card_question: cardQuestion } : {}),
    ...(s.options !== undefined ? { options: relabel(s.options, options) } : {}),
    ...(sets.length
      ? {
          option_sets: sets.map((set, i) => ({
            when: set.when,
            options: relabel(set.options, setLabels[i] ?? {}),
          })),
        }
      : {}),
    ...(s.help_when
      ? { help_when: s.help_when.map((h, i) => ({ when: h.when, help: helps[i] ?? h.help })) }
      : {}),
  });

  const labelBoxes = (list: unknown, labels: Labels, put: (code: string, v: string) => void) =>
    optionArray(list).flatMap((o) =>
      typeof o === 'string'
        ? []
        : [
            <Field key={o.code} label={`The words for ${o.code}`}>
              {(p) => (
                <TextInput
                  {...p}
                  value={labels[o.code] ?? ''}
                  maxLength={200}
                  onChange={(e) => {
                    put(o.code, e.target.value);
                  }}
                />
              )}
            </Field>,
          ],
    );

  return (
    <form
      className="form-stack"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        onSubmit({ label, help: help.trim() ? help : null, settings: settings() })
          .catch((err: unknown) => {
            setError(err instanceof Error ? err : new Error('That did not work.'));
          })
          .finally(() => {
            setBusy(false);
          });
      }}
    >
      <p className="muted">
        Only the words can change now. Every code stays as it is, because filed reports hold it.
      </p>
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
      {s.card_question !== undefined && (
        <Field label="The card’s own question">
          {(p) => (
            <TextInput
              {...p}
              value={cardQuestion}
              maxLength={160}
              onChange={(e) => {
                setCardQuestion(e.target.value);
              }}
            />
          )}
        </Field>
      )}
      {(s.help_when ?? []).map((h, i) => (
        <Field
          key={`${h.when.field}-${h.when.in.join(',')}`}
          label={`Help ${describeCondition(h.when, earlier)
            .replace(/^Asked only/, 'shown only')
            .replace(/\.$/, '')}`}
        >
          {(p) => (
            <TextInput
              {...p}
              value={helps[i] ?? ''}
              maxLength={1000}
              onChange={(e) => {
                const v = e.target.value;
                setHelps((now) => now.map((x, j) => (j === i ? v : x)));
              }}
            />
          )}
        </Field>
      ))}
      {labelBoxes(s.options, options, (code, v) => {
        setOptions((now) => ({ ...now, [code]: v }));
      })}
      {sets.map((set, i) => (
        <fieldset key={`${set.when.field}-${set.when.in.join(',')}`} className="panel quiet">
          <legend className="lbl">
            Choices {describeCondition(set.when, earlier).replace(/^Asked only/, 'offered only')}
          </legend>
          {labelBoxes(set.options, setLabels[i] ?? {}, (code, v) => {
            setSetLabels((now) => now.map((x, j) => (j === i ? { ...x, [code]: v } : x)));
          })}
        </fieldset>
      ))}
      <Problem error={error} />
      <div className="acts">
        <Btn type="submit" variant="secondary" disabled={busy}>
          Save the wording
        </Btn>
        <Btn type="button" variant="quiet" onClick={onCancel}>
          Cancel
        </Btn>
      </div>
    </form>
  );
}
