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
import { useId } from 'react';
import { Alert } from '../../components/ui/alert.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Page } from '../../components/ui/page.tsx';
import { PublishedFiles } from '../files/PublishedFiles.tsx';
import { boardReportQuery } from './queries.ts';
import { ReportAnswers } from './ReportAnswers.tsx';

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
    return (
      <Page title="No published report" width="prose">
        <Alert tone="serious">{query.error.message}</Alert>
        <Link to="/board" className="underline">
          Back to the board
        </Link>
      </Page>
    );
  }
  if (!query.data.published) {
    return (
      <Page title="Report board" width="prose">
        <Alert>{query.data.reason}</Alert>
      </Page>
    );
  }
  const { report: r, links } = query.data;
  return (
    <Page
      title={`Report ${r.public_ref}`}
      lede={`${r.logbook_title} · filed ${new Date(r.received_at).toLocaleString()}`}
      width="prose"
      actions={
        <Button asChild variant="secondary">
          <Link to="/verify/$ref" params={{ ref: r.public_ref }}>
            Check it has not been changed
          </Link>
        </Button>
      }
    >
      <Link to="/board" className="underline">
        Back to the board
      </Link>
      <Section title="What the reporter said">
        <ReportAnswers slug={r.logbook_slug} answers={r.answers} />
        {r.corrected ? (
          <p className="text-sm text-ink-alt">
            This is a corrected version. Its reporter corrected an earlier one, which is kept and
            still verifies.
          </p>
        ) : null}
        {r.third_party ? (
          <p className="text-sm text-ink-alt">
            Collected {INTAKE[r.third_party.intake_method] ?? ''} by {r.third_party.filed_via}
            {r.third_party.collected_on ? ` on ${r.third_party.collected_on}` : ''}, and filed by
            them on the reporter’s behalf.
          </p>
        ) : null}
        <PublishedFiles publicRef={r.public_ref} />
      </Section>
      {r.editorial_note ? <Note note={r.editorial_note} links={links} /> : null}
    </Page>
  );
}

function Note({
  note,
  links,
}: {
  note: PublicNote;
  links: {
    id: number;
    title: string;
    publisher: string | null;
    published_on: string | null;
    url: string;
  }[];
}) {
  return (
    <Section title="A note from the archive">
      {note.state === 'published' ? (
        <>
          {/* Plain text: blank lines are paragraphs, and nothing is rendered as HTML. */}
          {note.body.split(/\n\s*\n/).map((p, i) => (
            <p key={i} className="whitespace-pre-wrap">
              {p}
            </p>
          ))}
          <p className="text-sm text-ink-alt">
            Written {new Date(note.written_at).toLocaleDateString()} by the editors
            {note.revised ? `, revised (this is version ${String(note.versions)})` : ''}.
          </p>
          {links.length ? (
            <div>
              <h3 className="font-semibold">Sources</h3>
              <ul className="list-disc pl-5">
                {links.map((l) => (
                  <li key={l.id}>
                    <a href={l.url} rel="noopener noreferrer nofollow" className="underline">
                      {l.title}
                    </a>
                    {l.publisher ? `, ${l.publisher}` : ''}
                    {l.published_on ? `, ${l.published_on}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        <p>{note.notice}</p>
      )}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5"
    >
      <h2 id={id} className="font-display text-xl font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}
