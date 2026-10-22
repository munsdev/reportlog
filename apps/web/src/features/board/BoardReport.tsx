/**
 * One published report: what its reporter said, where it came from, the
 * archive's own note on it if there is one, and the way to check it has not
 * been changed. Anything not published reads exactly like a reference that
 * does not exist.
 */
import type { PublicNote } from '@reportlog/contracts';
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
import { CheckAReport } from './CheckAReport.tsx';
import { PublishedFiles } from '../files/PublishedFiles.tsx';
import { boardReportQuery } from './queries.ts';
import { ReportAnswers } from './ReportAnswers.tsx';
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
        <Card variant="quiet" heading="Check a report">
          <CheckAReport help="A report that is not published can still be checked by its reference." />
        </Card>
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
        {/* The reference as it is written, in mono, never in the display
            face's capitals or stretch. */}
        <h1 className="font-mono text-[clamp(1.5rem,1.2rem+1.5vw,2.25rem)] leading-tight font-medium tracking-normal break-all normal-case">
          {r.public_ref}
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Meta>Filed {new Date(r.received_at).toLocaleString()}</Meta>
          <ReportTags r={r} />
        </div>
      </div>
      <Card heading="What the reporter said">
        <ReportAnswers slug={r.logbook_slug} answers={r.answers} />
        {r.corrected ? (
          <p className="max-w-prose text-sm text-ink-alt">
            This is a corrected version. Its reporter corrected an earlier one, which is kept and
            still verifies.
          </p>
        ) : null}
      </Card>
      <PublishedFiles publicRef={r.public_ref} />
      {r.editorial_note ? <Note note={r.editorial_note} /> : null}
      <Card heading="Check it has not been changed">
        <p className="max-w-prose">
          Anybody can check, in their own browser, that this report is exactly what was filed and
          that nothing has been inserted or removed around it.
        </p>
        <p className="flex flex-col gap-1">
          <span className="text-sm text-ink-alt">Its link in the chain</span>
          <Meta className="break-all text-ink">{r.chain_hash}</Meta>
        </p>
        <div>
          <Button asChild>
            <Link to="/verify/$ref" params={{ ref: r.public_ref }}>
              Check this report
            </Link>
          </Button>
        </div>
      </Card>
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
