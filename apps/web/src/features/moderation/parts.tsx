/**
 * Pieces the moderation screens share: the head of a staff page, a width
 * test, a report's answers in words, its status as a chip, and the toasts.
 */
import type { FormQuestion, QueueItem } from '@reportlog/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Chip } from '../../mockup/Chip.tsx';
import { plainSiteName, useSite } from '../../components/ui/site.tsx';
import { publicLogbookQuery } from '../form/FilingForm.tsx';
import { askedQuestions, rawFromAnswers, shownAnswer } from '../form/walk.ts';
import { SEVERITY_WORDS } from './words.ts';

/**
 * A staff page's head: the mock-up's `.phead` (eyebrow, title, lede). Its
 * own rather than `StaffPage`'s for the pages that draw their body
 * themselves; one report's title is its reference, in the mono face. It
 * names the browser tab, as `StaffPage` does.
 */
export function StaffHead({
  eyebrow,
  title,
  mono = false,
  lede,
  children,
}: {
  eyebrow?: ReactNode;
  title: string;
  mono?: boolean;
  lede?: ReactNode;
  children?: ReactNode;
}) {
  const site = useSite().data;
  const siteName = plainSiteName(site);
  useEffect(() => {
    document.title = `${title} · ${siteName}`;
  }, [title, siteName]);
  return (
    <div className="phead">
      <div className="phead-txt">
        <span className="eyebrow">{eyebrow ?? `${siteName} · Staff`}</span>
        <h1 id="h1" className={mono ? 'mono-title' : undefined}>
          {title}
        </h1>
        {lede ? <p className="lead">{lede}</p> : null}
        {children}
      </div>
    </div>
  );
}

/**
 * Whether the screen is at least this wide, kept current. Used where the
 * phone and the desktop get different elements (a dialog against a panel),
 * not merely different styles.
 */
export function useWide(minWidth = 768): boolean {
  const query = `(min-width: ${String(minWidth)}px)`;
  const read = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : true;
  const [wide, setWide] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const m = window.matchMedia(query);
    const update = () => {
      setWide(m.matches);
    };
    update();
    m.addEventListener('change', update);
    return () => {
      m.removeEventListener('change', update);
    };
  }, [query]);
  return wide;
}

/** The questions of a logbook, without its file questions, for reading answers. */
function useQuestions(slug: string): FormQuestion[] {
  const logbook = useQuery({ ...publicLogbookQuery(slug), staleTime: 5 * 60_000 });
  return (logbook.data?.fields ?? []).filter((q) => q.kind !== 'file');
}

/** Each answer the reporter was asked for, by its question's label, in words. */
function answerRows(questions: FormQuestion[], answers: Record<string, unknown>) {
  if (!questions.length) {
    // Before the questions arrive, or if they cannot: the keys, plainly.
    return Object.entries(answers).map(([k, v]) => ({
      key: k,
      label: k,
      text: Array.isArray(v) ? v.join(', ') : String(v),
    }));
  }
  const raw = rawFromAnswers(questions, answers);
  return askedQuestions(questions, raw)
    .map((q) => ({ key: q.key, label: q.label, text: shownAnswer(q, raw, questions) }))
    .filter((x): x is { key: string; label: string; text: string } => x.text !== null);
}

/** A report's answers in one or two lines, in words, never codes: for a queue row. */
export function AnswerLine({ slug, answers }: { slug: string; answers: Record<string, unknown> }) {
  const rows = answerRows(useQuestions(slug), answers);
  const line = rows
    .map((r) => r.text.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .map((t) => (/[.!?…]$/.test(t) ? t : `${t}.`))
    .join(' ');
  return <p className="qsum">{line || 'No answers.'}</p>;
}

/** A report's answers by label, for the report under moderation. */
export function AnswerList({ slug, answers }: { slug: string; answers: Record<string, unknown> }) {
  const rows = answerRows(useQuestions(slug), answers);
  if (!rows.length) return <p>No answers.</p>;
  return (
    <dl className="answers">
      {rows.map((r) => (
        <div key={r.key}>
          <dt>{r.label}</dt>
          <dd style={{ whiteSpace: 'pre-wrap' }}>{r.text}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Where a report stands, as the mock-up's status chip. Filled only for an approval. */
export function StatusChip({ r }: { r: Pick<QueueItem, 'moderation_status' | 'withdrawn'> }) {
  if (r.withdrawn) return <Chip kind="off">Withdrawn</Chip>;
  switch (r.moderation_status) {
    case 'valid':
      return <Chip kind="ok">Approved</Chip>;
    case 'invalid':
      return <Chip kind="off">Declined</Chip>;
    case 'unknown':
      return <Chip>Unclear</Chip>;
    default:
      return <Chip kind="wait">Waiting</Chip>;
  }
}

/**
 * A rating as a chip: the two that mean somebody was or could be harmed are
 * filled red; the two that do not are a plain fact.
 */
export function SeverityChip({ severity }: { severity: QueueItem['severity'] }) {
  if (!severity) return null;
  const label = SEVERITY_WORDS[severity]?.label ?? severity;
  const grave = severity === 'serious' || severity === 'systemic';
  return grave ? <span className="st bad">{label}</span> : <Chip>{label}</Chip>;
}

/** "3 Nov 14:02", the way the record and the rows write a time. */
export const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** "41 minutes", "3 hours", "2 days": how long something has waited. */
export function waited(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return minutes === 1 ? '1 minute' : `${String(minutes)} minutes`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return hours === 1 ? '1 hour' : `${String(hours)} hours`;
  return `${String(Math.round(hours / 24))} days`;
}
