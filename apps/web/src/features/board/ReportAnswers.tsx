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
  pills = false,
}: {
  slug: string;
  answers: Record<string, unknown>;
  /** At most this many rows, for a list; the full report shows them all. */
  only?: number;
  /** As a board card shows them: pills, and the reporter's words clamped. */
  pills?: boolean;
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
  const all = askedQuestions(questions, raw)
    .map((q) => ({ q, text: shownAnswer(q, raw, questions) }))
    .filter((x): x is { q: FormQuestion; text: string } => x.text !== null);
  if (pills) {
    // On a board card: the answers as pills, and the reporter's own words
    // under them, cut to four lines; the report's page shows them whole.
    const short = all.filter((x) => x.q.kind !== 'long_text').slice(0, only);
    const words = all.filter((x) => x.q.kind === 'long_text');
    return (
      <div className="flex flex-col gap-3">
        {short.length ? (
          <dl className="flex flex-wrap gap-2">
            {short.map(({ q, text }) => (
              <div
                key={q.key}
                className="flex max-w-full flex-wrap gap-x-1 rounded-control border border-ink-alt px-2.5 py-1 text-sm"
              >
                <dt className="text-ink-alt">
                  {q.label}
                  <span aria-hidden="true"> ·</span>
                </dt>
                <dd className="min-w-0 break-words">{text}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {words.map(({ q, text }) => (
          <p key={q.key} className="line-clamp-4 max-w-prose whitespace-pre-wrap">
            <span className="sr-only">{q.label}: </span>
            {text}
          </p>
        ))}
      </div>
    );
  }
  const shown = all.slice(0, only);
  // The mock-up's key and value list (.kv-list): a rule between rows, the
  // question in the small label face, the answer beside it from 640px.
  return (
    <dl className="kv-list">
      {shown.map(({ q, text }) => (
        <div key={q.key}>
          <dt>{q.label}</dt>
          <dd style={{ whiteSpace: 'pre-wrap' }}>{text}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A heading a person can read for one report: where (its first location
 * answer, by name) and what (its first single choice), as "Arizona ·
 * Something went wrong". Null until the questions arrive, or when the report
 * answered neither; the card then falls back to the logbook's title. The
 * reference stays on the card, small, under it: it is how a report is
 * checked, not what somebody scans a list for.
 */
export function useReportHeadline(slug: string, answers: Record<string, unknown>): string | null {
  const { where, what } = useReportParts(slug, answers);
  const parts = [where, what].filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(' · ') : null;
}

/** The same two facts apart: where (a location answer) and what (a single choice). */
export function useReportParts(
  slug: string,
  answers: Record<string, unknown>,
): { where: string | null; what: string | null } {
  const logbook = useQuery({ ...publicLogbookQuery(slug), staleTime: 5 * 60_000 });
  const questions: FormQuestion[] = logbook.data?.fields ?? [];
  if (!questions.length) return { where: null, what: null };
  const raw = rawFromAnswers(questions, answers);
  const asked = askedQuestions(questions, raw);
  const pick = (kind: string) => {
    const q = asked.find((x) => x.kind === kind && shownAnswer(x, raw, questions) !== null);
    return q ? shownAnswer(q, raw, questions) : null;
  };
  return { where: pick('location'), what: pick('choice_one') };
}
