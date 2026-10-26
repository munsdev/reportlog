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
import { useEffect } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card } from '../../components/ui/card.tsx';
import { plainSiteName, useSite } from '../../components/ui/site.tsx';
import { Eyebrow, Meta } from '../../components/ui/type.tsx';
import { ApiRequestError } from '../../lib/api.ts';
import { PublishedFiles } from '../files/PublishedFiles.tsx';
import { boardReportQuery } from './queries.ts';
import { ReportAnswers, useReportHeadline } from './ReportAnswers.tsx';
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
  const site = plainSiteName(useSite().data);
  const title = query.data?.published ? query.data.report.public_ref : 'No published report';
  useEffect(() => {
    if (!query.isPending) document.title = `${title} · ${site}`;
  }, [title, site, query.isPending]);
  if (query.isPending) return <p role="status">Loading…</p>;
  if (query.isError) {
    // Not public, counts only, or never filed: the same page, on purpose.
    const missing = query.error instanceof ApiRequestError && query.error.status === 404;
    return (
      <ReportColumn>
        <BackToBoard />
        <h1 className="font-display text-title">No published report</h1>
        {missing ? (
          <p className="max-w-prose">There is no published report with that reference.</p>
        ) : (
          <Alert tone="serious" title="This report could not be loaded">
            {query.error.message}
          </Alert>
        )}
      </ReportColumn>
    );
  }
  if (!query.data.published) {
    return (
      <ReportColumn>
        <BackToBoard />
        <h1 className="font-display text-title">No published report</h1>
        <Card variant="deep">
          <p className="font-semibold">
            Publishing is paused. Reports still arrive and are being read.
          </p>
        </Card>
      </ReportColumn>
    );
  }
  const { report: r } = query.data;
  return (
    <ReportColumn>
      <BackToBoard />
      <div className="flex flex-col gap-2">
        <Eyebrow>{r.logbook_title}</Eyebrow>
        <ReportHeading r={r} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <ReportTags r={r} />
        </div>
      </div>
      <Card heading="What the reporter said">
        <ReportAnswers slug={r.logbook_slug} answers={r.answers} />
        {r.corrected ? (
          <p className="max-w-prose text-sm text-ink-alt">
            This is a corrected version. Its reporter corrected an earlier one, which is kept.
          </p>
        ) : null}
      </Card>
      <PublishedFiles publicRef={r.public_ref} />
      {r.editorial_note ? <Note note={r.editorial_note} /> : null}
      <p>
        <Link
          to="/verify/$ref"
          params={{ ref: r.public_ref }}
          className="underline underline-offset-4"
        >
          Check this report
        </Link>
      </p>
      {r.third_party ? (
        // Which organization, never who typed it.
        <p className="max-w-prose text-sm text-ink-alt">
          Filed through {r.third_party.filed_via}
          {r.third_party.collected_on ? `, collected ${r.third_party.collected_on}` : ''}
          {INTAKE[r.third_party.intake_method]
            ? ` ${INTAKE[r.third_party.intake_method] ?? ''}`
            : ''}
          .
        </p>
      ) : null}
    </ReportColumn>
  );
}

function ReportColumn({ children }: { children: ReactNode }) {
  return <article className="flex max-w-prose flex-col gap-6">{children}</article>;
}

function BackToBoard() {
  return (
    <p className="print:hidden">
      <Button asChild variant="quiet" className="-ml-2">
        <Link to="/board">← Back to the board</Link>
      </Button>
    </p>
  );
}

function Note({ note }: { note: PublicNote }) {
  return (
    <Card variant="quiet" heading="A note from the archive">
      {note.state === 'published' ? (
        <>
          {/* Plain text: blank lines are paragraphs, and nothing is rendered as HTML. */}
          {note.body.split(/\n\s*\n/).map((p, i) => (
            <p key={i} className="max-w-prose whitespace-pre-wrap">
              {p}
            </p>
          ))}
          <p className="text-sm text-ink-alt">
            Written <Meta>{new Date(note.written_at).toLocaleDateString()}</Meta> by the editors
            {note.revised ? `, revised (this is version ${String(note.versions)})` : ''}.
          </p>
        </>
      ) : (
        <p className="max-w-prose">{note.notice}</p>
      )}
    </Card>
  );
}

/**
 * Where and what as the heading, the reference under it. The reference as it
 * is written, in mono, never in the display face's capitals or stretch.
 */
function ReportHeading({ r }: { r: PublicReport }) {
  const headline = useReportHeadline(r.logbook_slug, r.answers);
  return (
    <h1 className="flex flex-col gap-1">
      {headline ? <span className="font-display text-title">{headline}</span> : null}
      <span
        className={
          headline
            ? 'font-mono text-base font-medium tracking-normal break-all text-ink-alt normal-case'
            : 'font-mono text-[clamp(1.5rem,1.2rem+1.5vw,2.25rem)] leading-tight font-medium tracking-normal break-all normal-case'
        }
      >
        {r.public_ref}
      </span>
    </h1>
  );
}
