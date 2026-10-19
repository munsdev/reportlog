/**
 * What the account dialog and the correction share: a logbook's questions,
 * the publication question in the coordinators' wording, and the statement a
 * coordinator attests to.
 */
import type { FormQuestion, PublicationCard } from '@reportlog/contracts';
import { QuestionControl } from '@/features/form/QuestionControl.tsx';
import { askedQuestions, cardProblem } from '@/features/form/walk.ts';
import type { RawAnswers, RawValue } from '@/features/form/walk.ts';
import { RadioGroup, RadioOption } from '@/components/ui/radio-group.tsx';

/**
 * The statement, in the words the coordinator ticks. The server refuses to
 * file without `attested: true`; these are the words that make it mean
 * something. Kept from the old application.
 */
export const BATCH_STATEMENT =
  'I received each of these accounts from a source, named or anonymous, and I have transcribed them faithfully. I have checked them over.';
export const CORRECTION_STATEMENT =
  'This correction is what the source gave me, and I have transcribed it faithfully. I have checked it over.';

/**
 * The questions being asked, in order, each with its own control. Every
 * question is on screen at once here, unlike the reporter's cards: the
 * coordinator is copying a sheet, not being asked.
 */
export function Questions({
  idPrefix,
  questions,
  raw,
  onChange,
  showProblems,
}: {
  idPrefix: string;
  questions: readonly FormQuestion[];
  raw: RawAnswers;
  onChange: (key: string, value: RawValue) => void;
  showProblems: boolean;
}) {
  return (
    <>
      {askedQuestions(questions, raw).map((q) => {
        const err = showProblems ? cardProblem(q, raw) : null;
        const id = `${idPrefix}-${q.key}`;
        return (
          <div key={q.key} className="flex flex-col gap-2">
            <p id={id} className="font-semibold">
              {q.label}
              {q.required ? '' : ' (optional)'}
            </p>
            {q.help ? <p className="text-sm text-ink-alt">{q.help}</p> : null}
            <QuestionControl
              question={q}
              value={raw[q.key]}
              onChange={(v) => {
                onChange(q.key, v);
              }}
              labelledBy={id}
              invalid={Boolean(err)}
            />
            {err ? <p className="text-sm font-semibold text-serious">{err}</p> : null}
          </div>
        );
      })}
    </>
  );
}

/** "May it be published?", in the wording coordinators are shown, as the source answered it. */
export function PublicationChoice({
  card,
  value,
  onChange,
  only,
}: {
  card: PublicationCard | undefined;
  value: string;
  onChange: (v: string) => void;
  /** Offer only these answers (a correction may take permission back, never give it). */
  only?: readonly ('yes' | 'no')[];
}) {
  if (!card) return <p role="status">Loading the publication question…</p>;
  const offered = only ?? (['yes', 'no'] as const);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend id="publish-question" className="font-semibold">
        {card.question} What the person said when you asked them:
      </legend>
      {card.body.map((line) => (
        <p key={line} className="text-sm text-ink-alt">
          {line}
        </p>
      ))}
      <RadioGroup value={value} onValueChange={onChange} aria-labelledby="publish-question">
        {offered.map((o) => (
          <RadioOption key={o} value={o} label={card.options[o]} />
        ))}
      </RadioGroup>
    </fieldset>
  );
}
