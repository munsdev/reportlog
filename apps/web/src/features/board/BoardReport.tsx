/**
 * One published report: what its reporter said, where it came from, the
 * archive's own note on it if there is one, and the way to check it has not
 * been changed. Anything not published reads exactly like a reference that
 * does not exist.
 */
import type { PublicNote, PublicReport } from '@reportlog/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Card } from '../../components/ui/card.tsx';
import { Meta } from '../../components/ui/type.tsx';
import { AsideCard, BandPage, TwoCol, Wrap } from '../../components/ui/band.tsx';
import { CopyBox } from '../site-pages/CopyBox.tsx';
import { CopyButton } from '../site-pages/CopyButton.tsx';
import { ApiRequestError } from '../../lib/api.ts';
import { PublishedFiles } from '../files/PublishedFiles.tsx';
import { boardReportQuery } from './queries.ts';
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
  if (query.isPending) return <p role="status">Loading…</p>;
  if (query.isError) {
    // Not public, counts only, or never filed: the same page, on purpose.
    const missing = query.error instanceof ApiRequestError && query.error.status === 404;
    return (
      <BandPage title="No published report" eyebrow="Published report">
        <BackToBoard />
        {missing ? (
          <p className="max-w-prose">There is no published report with that reference.</p>
        ) : (
          <Alert tone="serious" title="This report could not be loaded">
            {query.error.message}
          </Alert>
        )}
      </BandPage>
    );
  }
  if (!query.data.published) {
    return (
      <BandPage title="No published report" eyebrow="Published report">
        <BackToBoard />
        <Card variant="deep">
          <p className="font-semibold">
            Publishing is paused. Reports still arrive and are being read.
          </p>
        </Card>
      </BandPage>
    );
  }
  return <PublishedReport r={query.data.report} />;
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
  return (
    <BandPage
      title={r.public_ref}
      heading={what ?? where ?? r.logbook_title}
      eyebrow={`Published report · ${where ?? r.logbook_title}`}
      band={
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
          <ReportTags r={r} />
          <span className="font-mono text-sm break-all text-muted">
            {r.public_ref} · Filed {filedAt}
          </span>
        </div>
      }
      bare
    >
      <Wrap className="pt-8 pb-16">
        <BackToBoard />
        <TwoCol
          className="mt-3"
          asideLabel="Share and cite"
          aside={
            <>
              <AsideCard title="Share" plain>
                <CopyBox text={address} what="the link" code={address} />
              </AsideCard>
              <AsideCard title="Cite this report" plain>
                <p className="rounded-control border-[1.5px] border-line bg-surface p-3 font-mono text-sm break-words text-ink">
                  {citation}
                </p>
                <CopyButton text={citation} what="the citation" />
              </AsideCard>
              <AsideCard title="Filed this report?" plain>
                <p>
                  If you left an email, the link we sent lets you correct or withdraw it. Without
                  one, a report cannot be changed; file a new one.
                </p>
              </AsideCard>
            </>
          }
        >
          <ReportBody r={r} />
        </TwoCol>
      </Wrap>
    </BandPage>
  );
}

function ReportBody({ r }: { r: PublicReport }) {
  return (
    <>
      <h2 className="sr-only">What the reporter said</h2>
      <ReportAnswers slug={r.logbook_slug} answers={r.answers} />
      {r.corrected ? (
        <p className="max-w-prose text-sm text-ink-alt">
          This is a corrected version. Its reporter corrected an earlier one, which is kept.
        </p>
      ) : null}
      <PublishedFiles publicRef={r.public_ref} />
      {r.editorial_note ? <Note note={r.editorial_note} /> : null}
      <details className="rounded-card border-[1.5px] border-line bg-surface p-4">
        <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
          Technical details
        </summary>
        <div className="mt-3 grid gap-2 text-sm">
          <span className="label-face text-xs text-muted">Chain value</span>
          <span className="font-mono break-all">{r.chain_hash}</span>
          <Link
            to="/verify/$ref"
            params={{ ref: r.public_ref }}
            className="inline-flex min-h-11 items-center underline underline-offset-4"
          >
            Check this report
          </Link>
        </div>
      </details>
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
    </>
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
    <p className="rounded-control border-[1.5px] border-dashed border-ink bg-surface p-3 text-[0.92rem]">
      <b className="font-display">This report also has {what}.</b> They are not published.
    </p>
  );
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
