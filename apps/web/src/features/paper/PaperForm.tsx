/**
 * The paper copy of a logbook's or a list's form: printed, filled in by
 * hand, and typed in afterwards. Asked for by group coordinators, so a
 * group does not make its own sheets and translate them into ours.
 *
 * ONE QUESTION ON PAPER IS ONE QUESTION ONLINE, numbered in the form's own
 * order, with the same options in the same words. A paper sheet is typed in
 * through coordinator intake (features/intake/), which asks the logbook's
 * questions, how and when the sheet was collected, the coordinator's own
 * reference for it, and the publication question in its COORDINATOR wording.
 * So the sheet prints exactly that card, word for word: a report seals the
 * digest of the wording the person agreed to, and the paper must be that
 * wording. The office box at the bottom is the rest of what intake asks.
 *
 * A PLACE IS LINES, never the list of every state and county the online
 * picker offers. Before printing, the screen lets somebody write a place in
 * (their own state and county, say) so a hundred copies carry it.
 *
 * ONE PAGE IF IT FITS. The sheet is measured at a few sizes and printed at
 * the largest that fits one page. A form that fits at none runs on, and
 * breaks only between whole cards, never through a question.
 *
 * Printing is the browser's: Print, or Save as PDF. Nothing is sent and no
 * other host is asked for anything (e2e/paper.spec.ts).
 */
import type { PublicationCard } from '@reportlog/contracts';
import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Btn } from '@/mockup/Btn.tsx';
import { Note } from '@/mockup/Note.tsx';
import type { PaperQuestion, PaperSection } from './paperQuestions.ts';
import './paper.css';

/** The sizes tried, largest first: a scale on the sheet's body size. */
const SCALES = [1, 0.93, 0.86, 0.8, 0.75] as const;
/** One printed page's usable height in CSS px: Letter, half-inch margins (A4 is taller). */
export const PAGE_PX = 960;

export interface PaperProps {
  kind: 'logbook' | 'list';
  title: string;
  blurb: string | null;
  sections: PaperSection[];
  /** The address the same form is filled in online. */
  onlineAt: string;
  /** A logbook's publication question, in the coordinator's wording. */
  card?: PublicationCard | undefined;
  /** Where publication is a condition of filing: its terms instead of a question. */
  terms?: { heading: string; body: string[] } | undefined;
  /** The form version the questions are, so the sheet is typed in against them. */
  version?: string | undefined;
  /** Whether the form asks for files, which paper cannot carry. */
  asksFiles: boolean;
}

export function PaperForm(props: PaperProps) {
  const sheet = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState(1);
  const [written, setWritten] = useState<Record<string, string>>({});
  const places = props.sections.flatMap((s) => s.questions).filter((q) => q.place);

  // Measure at each size, keep the largest that fits one page. Synchronous,
  // before paint, so the sheet never flickers through the sizes.
  useLayoutEffect(() => {
    const el = sheet.current;
    if (!el) return;
    for (const s of SCALES) {
      el.style.setProperty('--paper-scale', String(s));
      if (el.scrollHeight <= PAGE_PX) {
        setPages(1);
        return;
      }
    }
    el.style.setProperty('--paper-scale', '1');
    setPages(Math.ceil(el.scrollHeight / PAGE_PX));
  }, [props, written]);

  return (
    <div className="paper-page">
      <div className="paper-controls" aria-label="Printing">
        <p className="eyebrow">Paper copy</p>
        <h1 className="h-page">{props.title}</h1>
        <p>
          Print it, or save it as a PDF, and hand out as many copies as you need. Whoever collects
          them types each one in, question by question.
        </p>
        {places.length ? (
          <fieldset className="paper-prefill">
            <legend>Before you print (optional)</legend>
            <p className="muted">
              Write a place in here and every copy carries it, so people do not have to.
            </p>
            {places.map((q) => (
              <label key={q.key}>
                <span>
                  {String(q.n)}. {q.label}
                </span>
                <input
                  value={written[q.key] ?? ''}
                  onChange={(e) => {
                    setWritten((w) => ({ ...w, [q.key]: e.target.value }));
                  }}
                />
              </label>
            ))}
          </fieldset>
        ) : null}
        <p role="status">
          {pages === 1
            ? 'It fits on one page.'
            : `It runs to about ${String(pages)} pages, broken between questions.`}
        </p>
        <Btn
          look="go"
          onClick={() => {
            window.print();
          }}
        >
          Print it or save it as a PDF
        </Btn>
      </div>

      {/* Its size is set by the measuring above, not by a style here. */}
      <div className="paper-frame">
        <div ref={sheet} className="paper-sheet" data-print-only>
          <Sheet {...props} written={written} />
        </div>
      </div>
    </div>
  );
}

function Sheet({ written, ...p }: PaperProps & { written: Record<string, string> }) {
  return (
    <>
      <header className="pf-head">
        <div>
          <p className="pf-eyebrow">{p.kind === 'logbook' ? 'Report form' : 'Form'}</p>
          <h2 className="pf-title">{p.title}</h2>
        </div>
        <p className="pf-online">
          Online instead:
          <br />
          <b>{p.onlineAt}</b>
        </p>
      </header>
      {p.blurb ? <p className="pf-blurb">{p.blurb}</p> : null}
      <p className="pf-how">
        Write clearly, in capital letters, and put a cross in a box to choose it. A question marked
        * needs an answer; leave out any that do not apply to you. Hand the sheet back to the person
        who gave it to you.
      </p>

      {/* Short cards (a date, a time, a state) sit two to a row; the rest take the width. */}
      <div className="pf-grid">
        {p.sections.map((s, i) => (
          <section
            className={s.questions.every(isShort) ? 'pf-card pf-half' : 'pf-card'}
            key={s.questions[0]?.key ?? i}
          >
            {s.heading ? <h3 className="pf-card-head">{s.heading}</h3> : null}
            {s.questions.map((q) => (
              <Question key={q.key} q={q} written={written[q.key]} />
            ))}
          </section>
        ))}
      </div>

      {p.asksFiles ? (
        <section className="pf-card pf-aside">
          Photos and other files cannot go on paper. To add them, fill the form in online at{' '}
          <b>{p.onlineAt}</b>.
        </section>
      ) : null}

      {p.terms ? (
        <section className="pf-card">
          <h3 className="pf-q">{p.terms.heading}</h3>
          {p.terms.body.map((t) => (
            <p className="pf-help" key={t}>
              {t}
            </p>
          ))}
        </section>
      ) : p.card ? (
        <section className="pf-card">
          <h3 className="pf-q">
            {p.card.question} <span className="pf-req">*</span>
          </h3>
          <div className="pf-terms">
            {p.card.body.map((t) => (
              <p key={t}>{t}</p>
            ))}
            <p>{p.card.optionality}</p>
          </div>
          <Boxes options={[p.card.options.yes, p.card.options.no]} round />
        </section>
      ) : null}

      {p.kind === 'logbook' ? (
        <section className="pf-card pf-office">
          <p className="pf-office-head">
            For the group coordinator. Not part of the report, never published.
          </p>
          <div className="pf-office-grid">
            <Blank label="Sheet reference" />
            <Blank label="Collected on" />
            <Blank label="Typed in on" />
          </div>
        </section>
      ) : null}

      <footer className="pf-foot">
        <span>{p.onlineAt}</span>
        {p.version ? <span>Form version {p.version.slice(0, 12)}</span> : null}
      </footer>
    </>
  );
}

/** A question whose answer is one short line or two boxes. */
function isShort(q: PaperQuestion): boolean {
  if (q.place === 'county' || q.place === 'either') return false;
  if (q.help && q.help.length > 90) return false;
  return ['date', 'time', 'number', 'short_text', 'email', 'place', 'location', 'yes_no'].includes(
    q.kind,
  );
}

function Question({ q, written }: { q: PaperQuestion; written: string | undefined }) {
  const req = q.required ? <span className="pf-req">*</span> : null;
  if (q.checkbox) {
    return (
      <div className="pf-question">
        <p className="pf-q pf-tick">
          <span className="pf-box" aria-hidden /> <span>{String(q.n)}.</span> {q.label} {req}
        </p>
        {q.help ? <p className="pf-help">{q.help}</p> : null}
        {q.onlyIf ? <p className="pf-only">{q.onlyIf}</p> : null}
      </div>
    );
  }
  return (
    <div className="pf-question">
      <p className="pf-q">
        <span className="pf-n">{String(q.n)}.</span> {q.label} {req}
      </p>
      {q.onlyIf ? <p className="pf-only">{q.onlyIf}</p> : null}
      {q.help ? <p className="pf-help">{q.help}</p> : null}
      <Answer q={q} written={written} />
    </div>
  );
}

function Answer({ q, written }: { q: PaperQuestion; written: string | undefined }): ReactNode {
  switch (q.kind) {
    case 'long_text':
      return <Lines n={4} />;
    case 'date':
      return <Blank hint="month / day / year" />;
    case 'time':
      return <Blank hint="hour : minute, am or pm" />;
    case 'datetime':
      return (
        <div className="pf-row">
          <Blank hint="month / day / year" />
          <Blank hint="hour : minute, am or pm" />
        </div>
      );
    case 'number': {
      const range =
        q.min !== undefined && q.max !== undefined
          ? `a number from ${String(q.min)} to ${String(q.max)}`
          : 'a number';
      return <Blank hint={range} short />;
    }
    case 'yes_no':
      return <Boxes options={['Yes', 'No']} round />;
    case 'choice_one':
    case 'choice_many':
      return (
        <>
          <p className="pf-hint">
            {q.kind === 'choice_one' ? 'Tick one.' : 'Tick all that apply.'}
          </p>
          <Boxes options={q.options.map((o) => o.label)} round={q.kind === 'choice_one'} />
          {q.allowOther ? <Blank label="Other" /> : null}
        </>
      );
    case 'evidence_declaration':
      return <Boxes options={['Yes', 'No']} round />;
    case 'private_text':
      return <Lines n={3} />;
    case 'location':
    case 'place':
      return <PlaceLines place={q.place ?? 'any'} written={written} />;
    case 'file':
      return <p className="pf-hint">Files cannot go on paper: see the note below.</p>;
    case 'email':
      return <Blank hint="email address" />;
    case 'url':
    case 'private_link':
      return <Lines n={q.rows} hint="web address" />;
    default:
      return <Blank value={written} />;
  }
}

function PlaceLines({
  place,
  written,
}: {
  place: NonNullable<PaperQuestion['place']>;
  written: string | undefined;
}) {
  if (written?.trim()) return <Blank value={written} />;
  if (place === 'county') {
    return (
      <div className="pf-row">
        <Blank label="State" />
        <Blank label="County" />
      </div>
    );
  }
  if (place === 'country') return <Blank label="Country" />;
  if (place === 'either') return <Blank label="US state, or country" />;
  if (place === 'state') return <Blank label="State" />;
  return <Blank />;
}

function Boxes({ options, round = false }: { options: string[]; round?: boolean }) {
  return (
    <ul className="pf-options">
      {options.map((o) => (
        <li key={o}>
          <span className={round ? 'pf-box pf-round' : 'pf-box'} aria-hidden />
          {o}
        </li>
      ))}
    </ul>
  );
}

function Blank({
  label,
  hint,
  value,
  short = false,
}: {
  label?: string;
  hint?: string;
  value?: string | undefined;
  short?: boolean;
}) {
  return (
    <div className={short ? 'pf-blank pf-short' : 'pf-blank'}>
      {label ? <span className="pf-label">{label}</span> : null}
      <span className="pf-line">
        {value?.trim() ? <span className="pf-written">{value}</span> : null}
      </span>
      {hint ? <span className="pf-hint-under">{hint}</span> : null}
    </div>
  );
}

function Lines({ n, hint }: { n: number; hint?: string }) {
  return (
    <div className="pf-lines">
      {Array.from({ length: n }, (_, i) => (
        <span className="pf-line" key={i} />
      ))}
      {hint ? <span className="pf-hint-under">{hint}</span> : null}
    </div>
  );
}

/** What a page shows while the form is read, or when it cannot be. */
export function PaperNotice({ children }: { children: ReactNode }) {
  return (
    <div className="paper-page">
      <Note>{children}</Note>
    </div>
  );
}
