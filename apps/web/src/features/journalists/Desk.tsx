/**
 * The journalist desk (J9 to J11): /desk.
 *
 * For a vetted journalist who has accepted the journalist agreement (the
 * gate below, then the server's own guard on every call). Read-only, a page
 * at a time, with nothing to download: checked links with how many tips
 * carried each, the moderator's comment and the tips' multiple-choice
 * answers, and moderators' Sources links on published reports. Below them,
 * the journalist's own alert settings (decision 47).
 *
 * Every link is text, never an anchor: the site never fetches one, and a
 * journalist copies it into a browser on purpose. Every page shown is in the
 * access log (J12).
 */
import { DESK_PAGE_SIZE, deskLinks, deskSources } from '@reportlog/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Page } from '@/components/ui/page.tsx';
import { call } from '../../lib/api.ts';
import { StaffOnly } from '../identity/StaffOnly.tsx';
import { AgreementGate } from '../platform/Agreement.tsx';
import { DeskAlerts } from './AlertSettings.tsx';

export function DeskPage() {
  return (
    <StaffOnly needs="journalist">
      <AgreementGate audience="journalist">
        <Page
          title="Journalist desk"
          lede="Links moderators have checked, and the sources they cite on published reports. Read only; nothing here is public."
        >
          <Alert title="Before you use a link">
            A moderator checked each link, but did not verify what it shows. Treat it as a lead, not
            as a fact.
          </Alert>
          <CheckedLinks />
          <Sources />
          <DeskAlerts />
        </Page>
      </AgreementGate>
    </StaffOnly>
  );
}

function Pager({
  page,
  pages,
  label,
  onPage,
}: {
  page: number;
  pages: number;
  label: string;
  onPage: (n: number) => void;
}) {
  if (pages <= 1) return null;
  return (
    <nav aria-label={`${label} pages`} className="flex items-center gap-3">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={page <= 1}
        onClick={() => {
          onPage(page - 1);
        }}
      >
        Previous
      </Button>
      <span>
        Page {page} of {pages}
      </span>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={page >= pages}
        onClick={() => {
          onPage(page + 1);
        }}
      >
        Next
      </Button>
    </nav>
  );
}

function CheckedLinks() {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['desk', 'links', page],
    queryFn: ({ signal }) => call(deskLinks, { query: { page }, signal }),
    placeholderData: keepPreviousData,
    retry: false,
  });
  return (
    <section aria-labelledby="desk-links" className="flex flex-col gap-4">
      <h2 id="desk-links" className="font-display text-xl font-bold">
        Checked links
      </h2>
      {q.isPending ? <p role="status">Loading…</p> : null}
      {q.isError ? <Alert tone="serious">{q.error.message}</Alert> : null}
      {q.data && !q.data.links.length ? <p>No checked links yet.</p> : null}
      <ul className="flex flex-col gap-4">
        {q.data?.links.map((l) => (
          <li
            key={l.url}
            className="flex flex-col gap-2 rounded-card border border-line bg-surface p-5"
            data-desk-link
          >
            <p className="break-all font-mono">{l.url}</p>
            <p className="text-sm text-muted">
              {l.tips === 1 ? 'Sent in 1 tip' : `Sent in ${String(l.tips)} tips`} · checked{' '}
              {new Date(l.checked_at).toLocaleDateString()}
            </p>
            {l.comment ? (
              <p>
                <span className="font-semibold">Moderator’s comment: </span>
                {l.comment}
              </p>
            ) : null}
            {l.context.length ? (
              <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
                {l.context.map((c) => (
                  <div key={c.question} className="contents">
                    <dt className="text-muted">{c.question}</dt>
                    <dd>
                      {c.answers
                        .map((a) => (l.tips > 1 ? `${a.answer} (${String(a.tips)})` : a.answer))
                        .join(', ')}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </li>
        ))}
      </ul>
      {q.data ? (
        <Pager page={q.data.page} pages={q.data.pages} label="Checked links" onPage={setPage} />
      ) : null}
      <p className="text-sm text-muted">{DESK_PAGE_SIZE} to a page.</p>
    </section>
  );
}

function Sources() {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['desk', 'sources', page],
    queryFn: ({ signal }) => call(deskSources, { query: { page }, signal }),
    placeholderData: keepPreviousData,
    retry: false,
  });
  return (
    <section aria-labelledby="desk-sources" className="flex flex-col gap-4">
      <h2 id="desk-sources" className="font-display text-xl font-bold">
        Sources on published reports
      </h2>
      {q.isError ? <Alert tone="serious">{q.error.message}</Alert> : null}
      {q.data && !q.data.reports.length ? <p>No published report cites sources yet.</p> : null}
      <ul className="flex flex-col gap-4">
        {q.data?.reports.map((r) => (
          <li
            key={r.reference}
            className="flex flex-col gap-2 rounded-card border border-line bg-surface p-5"
          >
            <h3 className="font-semibold">
              <Link to="/board/$ref" params={{ ref: r.reference }} className="underline">
                Report {r.reference}
              </Link>
            </h3>
            {r.note ? <p className="whitespace-pre-wrap">{r.note}</p> : null}
            <ul className="flex flex-col gap-1 text-sm">
              {r.sources.map((s) => (
                <li key={s.url}>
                  {s.title}
                  {s.publisher ? `, ${s.publisher}` : ''}
                  {s.published_on ? `, ${s.published_on}` : ''}:{' '}
                  <span className="break-all font-mono">{s.url}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {q.data ? (
        <Pager page={q.data.page} pages={q.data.pages} label="Sources" onPage={setPage} />
      ) : null}
    </section>
  );
}
