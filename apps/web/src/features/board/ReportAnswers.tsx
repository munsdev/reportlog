/**
 * A report's answers under its logbook's questions, in the logbook's order,
 * showing only the questions that report was asked. Shared by the board and
 * the moderation screens, so both read an answer the same way the reporter
 * was shown it ("Yes", a place's name, never its code).
 *
 * The questions are the logbook's CURRENT ones. That is safe: a launched
 * logbook only ever gains an optional question, so a key never changes what
 * it means under an answer.
 */
import type { FormQuestion } from '@reportlog/contracts';
import { useQuery } from '@tanstack/react-query';
import { publicLogbookQuery } from '../form/FilingForm.tsx';
import { askedQuestions, rawFromAnswers, shownAnswer } from '../form/walk.ts';

export function ReportAnswers({
  slug,
  answers,
  only,
}: {
  slug: string;
  answers: Record<string, unknown>;
  /** At most this many rows, for a list; the full report shows them all. */
  only?: number;
}) {
  const logbook = useQuery({ ...publicLogbookQuery(slug), staleTime: 5 * 60_000 });
  const questions: FormQuestion[] = (logbook.data?.fields ?? []).filter((q) => q.kind !== 'file');
  if (!questions.length) {
    // Before the questions arrive, or if they cannot: the keys, plainly.
    const rows = Object.entries(answers).slice(0, only);
    return (
      <dl className="flex flex-col gap-2">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-sm font-semibold text-ink-alt">{k}</dt>
            <dd className="whitespace-pre-wrap">{Array.isArray(v) ? v.join(', ') : String(v)}</dd>
          </div>
        ))}
      </dl>
    );
  }
  const raw = rawFromAnswers(questions, answers);
  const shown = askedQuestions(questions, raw)
    .map((q) => ({ q, text: shownAnswer(q, raw) }))
    .filter((x) => x.text !== null)
    .slice(0, only);
  return (
    <dl className="flex flex-col gap-2">
      {shown.map(({ q, text }) => (
        <div key={q.key}>
          <dt className="text-sm font-semibold text-ink-alt">{q.label}</dt>
          <dd className="whitespace-pre-wrap">{text}</dd>
        </div>
      ))}
    </dl>
  );
}
