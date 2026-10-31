/**
 * One published report: what its reporter said, where it came from, the
 * archive's own note on it if there is one, and the way to check it has not
 * been changed. Anything not published reads exactly like a reference that
 * does not exist.
 */
import type { PublicNote, PublicReport } from '@reportlog/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ApiRequestError } from '../../lib/api.ts';
import { MockPage } from '../../mockup/Band.tsx';
import { CopyBox } from '../../mockup/CopyBox.tsx';
import { CopyButton } from '../../mockup/CopyButton.tsx';
import { Note as NoteStrip } from '../../mockup/Note.tsx';
import { Card, TwoCol } from '../../mockup/TwoCol.tsx';
import { useBodyClass } from '../../mockup/useBodyClass.ts';
import { usePageTitle } from '../../mockup/usePageTitle.ts';
import { PublishedFiles } from '../files/PublishedFiles.tsx';
import { useJournalistAccess } from '../journalists/access.ts';
import { JournalistExtras } from './JournalistExtras.tsx';
import { boardReportQuery, deskReportExtrasQuery } from './queries.ts';
import { ReportAnswers, useReportParts } from './ReportAnswers.tsx';
import { ReportTags } from './Board.tsx';

const INTAKE: Record<string, string> = {
  paper: 'on paper',
  phone: 'by phone',
  in_person: 'in person',
  email: 'by email',
  other: 'another way',
};

export function BoardReportPage({ publicRef }: { publicRef: string }) {
  const query = useQuery(boardReportQuery(publicRef));
  useBodyClass('light');
  if (query.isPending) return <p role="status">Loading…</p>;
  if (query.isError) {
    // Not public, counts only, or never filed: the same page, on purpose.
    const missing = query.error instanceof ApiRequestError && query.error.status === 404;
    return (
      <Shell eyebrow="Published report" title="No published report">
        <BackToBoard />
        {missing ? (
          <p>There is no published report with that reference.</p>
        ) : (
          <NoteStrip warn>
            <span role="alert">
              <b>This report could not be loaded.</b> {query.error.message}
            </span>
          </NoteStrip>
        )}
      </Shell>
    );
  }
  if (!query.data.published) {
    return (
      <Shell eyebrow="Published report" title="No published report">
        <BackToBoard />
        <NoteStrip>
          <span>
            <b>Publishing is paused.</b> Reports still arrive and are being read.
          </span>
        </NoteStrip>
      </Shell>
    );
  }
  return <PublishedReport r={query.data.report} />;
}

/** The mock-up's report band, and a plain wrap under it for a page with no report. */
function Shell({
  eyebrow,
  title,
  meta,
  children,
}: {
  eyebrow: string;
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  usePageTitle(title);
  return (
    <MockPage>
      <section className="band" aria-labelledby="h1">
        <div className="wrap">
          <span className="eyebrow">{eyebrow}</span>
          <h1 className="h-page" id="h1">
            {title}
          </h1>
          {meta}
        </div>
      </section>
      {meta ? (
        children
      ) : (
        <div className="wrap" style={{ paddingTop: 26, display: 'grid', gap: 22 }}>
          {children}
        </div>
      )}
    </MockPage>
  );
}

/** The mock-up's report page: a band, the answers, a note, and share and cite beside. */
function PublishedReport({ r }: { r: PublicReport }) {
  const { where, what } = useReportParts(r.logbook_slug, r.answers);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const address = `${origin}/board/${r.public_ref}`;
  const filedAt = new Date(r.received_at).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const citation = `Report ${r.public_ref}, filed ${filedAt}. ${address}`;
  // A journalist's extras (decision 81): asked only of one who may see them.
  const access = useJournalistAccess();
  const extras = useQuery(deskReportExtrasQuery(r.public_ref, access === 'yes'));
  return (
    <Shell
      eyebrow={`Published report · ${where ?? r.logbook_title}`}
      title={what ?? where ?? r.logbook_title}
      meta={
        <div className="btn-row">
          <ReportTags r={r} />
          <span className="mono muted" style={{ fontSize: '.8rem', overflowWrap: 'anywhere' }}>
            {r.public_ref} · Filed {filedAt}
          </span>
        </div>
      }
    >
      <TwoCol
        pad={26}
        asideLabel="Share and cite"
        aside={
          <>
            <Card title="Share" plain>
              <CopyBox text={address} what="the link" code={address} label="Copy link" />
            </Card>
            <Card title="Cite this report" plain>
              <div className="cite">{citation}</div>
              <span style={{ justifySelf: 'start' }}>
                <CopyButton text={citation} what="the citation" label="Copy citation" />
              </span>
            </Card>
            <Card title="Filed this report?" plain>
              <p>
                If you left an email, the link we sent lets you correct or withdraw it. Without one,
                a report cannot be changed; file a new one.
              </p>
            </Card>
          </>
        }
      >
        <div className="grid gap-[22px]">
          <ReportBody r={r} />
          <JournalistExtras extras={extras.data?.extras} />
        </div>
      </TwoCol>
    </Shell>
  );
}

function ReportBody({ r }: { r: PublicReport }) {
  return (
    <div style={{ display: 'grid', gap: 22 }}>
      <h2 className="vh">What the reporter said</h2>
      <ReportAnswers slug={r.logbook_slug} answers={r.answers} />
      {r.corrected ? (
        <p className="muted">
          This is a corrected version. Its reporter corrected an earlier one, which is kept.
        </p>
      ) : null}
      <PublishedFiles publicRef={r.public_ref} />
      {r.editorial_note ? <Note note={r.editorial_note} /> : null}
      <details className="tech">
        <summary>Technical details</summary>
        <div className="in">
          <span>Chain value</span>
          <span>{r.chain_hash}</span>
          <Link to="/verify/$ref" params={{ ref: r.public_ref }}>
            Check this report yourself
          </Link>
        </div>
      </details>
      {r.third_party ? (
        // Which organization, never who typed it.
        <p className="muted">
          Filed through {r.third_party.filed_via}
          {r.third_party.collected_on ? `, collected ${r.third_party.collected_on}` : ''}
          {INTAKE[r.third_party.intake_method]
            ? ` ${INTAKE[r.third_party.intake_method] ?? ''}`
            : ''}
          .
        </p>
      ) : null}
    </div>
  );
}

/**
 * The mock-up's lock note: a written account or a link was sent with this
 * report and is not published (D10). Says only that one exists; the content
 * is never on a public page. Nothing draws it until the public report
 * carries the flags (they are the free-text work's, not this page's).
 */
export function UnpublishedNote({ text, links }: { text: boolean; links: number }) {
  if (!text && !links) return null;
  const what = [
    text ? 'a written account' : null,
    links ? `${String(links)} link${links === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' and ');
  return (
    <div className="note lock">
      <span>
        <b>This report also has {what}.</b> They are not published.
      </span>
    </div>
  );
}

function BackToBoard() {
  return (
    <p className="print:hidden">
      <Link to="/board">← Back to the board</Link>
    </p>
  );
}

function Note({ note }: { note: PublicNote }) {
  return (
    <div className="cta">
      <span className="mark">A note from the archive</span>
      {note.state === 'published' ? (
        <>
          {/* Plain text: blank lines are paragraphs, and nothing is rendered as HTML. */}
          {note.body.split(/\n\s*\n/).map((p, i) => (
            <p key={i} style={{ whiteSpace: 'pre-wrap' }}>
              {p}
            </p>
          ))}
          <p className="muted" style={{ fontSize: '.9rem' }}>
            Written {new Date(note.written_at).toLocaleDateString()} by the editors
            {note.revised ? `, revised (this is version ${String(note.versions)})` : ''}.
          </p>
        </>
      ) : (
        <p>{note.notice}</p>
      )}
    </div>
  );
}
