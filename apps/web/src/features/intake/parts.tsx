/**
 * What the account dialog and the correction share: a logbook's questions,
 * the publication question in the coordinators' wording, and the statement a
 * coordinator attests to.
 */
import type { FormQuestion, PublicationCard } from '@reportlog/contracts';
import { QuestionControl } from '@/features/form/QuestionControl.tsx';
import { askedQuestions, cardProblem, sealedAnswers } from '@/features/form/walk.ts';
import type { RawAnswers, RawValue } from '@/features/form/walk.ts';
import { Choice, Choices } from '@/mockup/Choice.tsx';

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
  onChange: (key: string, value: RawValue | undefined) => void;
  showProblems: boolean;
}) {
  const answers = sealedAnswers(questions, raw);
  return (
    <>
      {askedQuestions(questions, raw).map((q) => {
        const err = showProblems ? cardProblem(q, raw, questions) : null;
        const id = `${idPrefix}-${q.key}`;
        return (
          <div key={q.key} className="field">
            <span className="lbl" id={id}>
              {q.label}
              {q.required ? '' : ' (optional)'}
            </span>
            {q.help ? <span className="help">{q.help}</span> : null}
            <QuestionControl
              question={q}
              value={raw[q.key]}
              onChange={(v) => {
                onChange(q.key, v);
              }}
              labelledBy={id}
              invalid={Boolean(err)}
              answers={answers}
              raw={raw}
            />
            {err ? (
              <p className="error" role="alert">
                {err}
              </p>
            ) : null}
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
    <div className="field" role="radiogroup" aria-labelledby="publish-question">
      <span className="lbl" id="publish-question">
        {card.question} What the person said when you asked them:
      </span>
      {card.body.map((line) => (
        <span className="help" key={line}>
          {line}
        </span>
      ))}
      <Choices>
        {offered.map((o) => (
          <Choice
            key={o}
            name="publish-answer"
            value={o}
            checked={value === o}
            onChange={() => {
              onChange(o);
            }}
          >
            {card.options[o]}
          </Choice>
        ))}
      </Choices>
    </div>
  );
}
