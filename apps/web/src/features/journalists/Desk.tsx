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
import { Card } from '@/components/ui/card.tsx';
import { Count } from '@/components/ui/count.tsx';
import { Empty } from '@/components/ui/empty.tsx';
import { Page } from '@/components/ui/page.tsx';
import { Pagination } from '@/components/ui/pagination.tsx';
import { plainSiteName, useSite } from '@/components/ui/site.tsx';
import { TabRow } from '@/features/nav/AreaTabs.tsx';
import { call } from '../../lib/api.ts';
import { StaffOnly } from '../identity/StaffOnly.tsx';
import { AgreementGate } from '../platform/Agreement.tsx';
import { DeskAlerts } from './AlertSettings.tsx';

export function DeskPage() {
  const siteName = plainSiteName(useSite().data);
  return (
    <StaffOnly needs="journalist">
      <AgreementGate audience="journalist">
        <Page
          eyebrow={siteName}
          title="Journalist desk"
          lede="Links moderators have checked, and the sources they cite on published reports. Read only; nothing here is public."
        >
          {/* Anchors on this page, not separate pages (account.md §11). */}
          <TabRow
            label="On this page"
            tabs={[
              { to: '/desk', hash: 'desk-links', label: 'Checked links', current: false },
              {
                to: '/desk',
                hash: 'desk-sources',
                label: 'Sources on published reports',
                current: false,
              },
            ]}
          />
          <Alert tone="warning" title="Before you use a link">
            A moderator checked each link, but did not verify what it shows. Treat it as a lead, not
            as a fact. Copying one is your choice: this site never opens it.
          </Alert>
          <CheckedLinks />
          <Sources />
          <DeskAlerts />
          <p className="text-sm text-ink-alt">
            Every page you open here is recorded in the access log.
          </p>
        </Page>
      </AgreementGate>
    </StaffOnly>
  );
}

/**
 * A link as text the journalist can select, and a button that copies it.
 * Never an anchor. The clipboard needs a secure page and is refused in some
 * embedded browsers; the text stays selectable either way, and the button
 * says when it could not copy.
 */
function CopyableLink({ url }: { url: string }) {
  const [said, setSaid] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <p className="font-mono break-all select-all">{url}</p>
      <div className="flex shrink-0 flex-col items-start gap-1">
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard.writeText(url).then(
              () => {
                setSaid('Copied.');
              },
              () => {
                setSaid('This browser would not copy it. Select the text instead.');
              },
            );
          }}
        >
          Copy the link
        </Button>
        {said ? (
          <p role="status" className="text-sm text-ink-alt">
            {said}
          </p>
        ) : null}
      </div>
    </div>
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
    <section
      aria-labelledby="desk-links-title"
      id="desk-links"
      className="flex scroll-mt-24 flex-col gap-4"
    >
      <h2 id="desk-links-title" className="font-display text-2xl font-bold">
        Checked links
      </h2>
      {q.isPending ? <p role="status">Loading…</p> : null}
      {q.isError ? <Alert tone="serious">{q.error.message}</Alert> : null}
      {q.data && !q.data.links.length ? (
        <Empty title="No checked links yet">
          When a moderator checks a link sent in a tip, it appears here.
        </Empty>
      ) : null}
      <ul className="flex flex-col gap-4">
        {q.data?.links.map((l) => (
          <li key={l.url} data-desk-link>
            <Card>
              <CopyableLink url={l.url} />
              <p className="flex flex-wrap items-center gap-2 text-sm text-ink-alt">
                <Count
                  value={l.tips}
                  label={l.tips === 1 ? 'Sent in 1 tip' : `Sent in ${String(l.tips)} tips`}
                />
                <span aria-hidden="true">{l.tips === 1 ? 'tip' : 'tips'}</span>
                <span>· checked {new Date(l.checked_at).toLocaleDateString()}</span>
              </p>
              {l.comment ? (
                <p>
                  <span className="font-semibold">Moderator’s comment: </span>
                  {l.comment}
                </p>
              ) : null}
              {l.context.length ? (
                <dl className="flex flex-col gap-2 text-sm">
                  {l.context.map((c) => (
                    <div key={c.question} className="flex flex-col gap-1">
                      <dt className="text-ink-alt">{c.question}</dt>
                      <dd className="flex flex-wrap gap-2">
                        {c.answers.map((a) => (
                          <span
                            key={a.answer}
                            className="inline-flex min-h-6 items-center rounded-full border border-ink-alt px-2.5 text-sm"
                          >
                            {l.tips > 1 ? `${a.answer} (${String(a.tips)})` : a.answer}
                          </span>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </Card>
          </li>
        ))}
      </ul>
      {q.data ? (
        <Pagination
          page={q.data.page}
          pages={q.data.pages}
          label="Checked links pages"
          onPage={setPage}
        />
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
    <section
      aria-labelledby="desk-sources-title"
      id="desk-sources"
      className="flex scroll-mt-24 flex-col gap-4"
    >
      <h2 id="desk-sources-title" className="font-display text-2xl font-bold">
        Sources on published reports
      </h2>
      {q.isError ? <Alert tone="serious">{q.error.message}</Alert> : null}
      {q.data && !q.data.reports.length ? (
        <Empty title="No sources yet">
          When a moderator cites a source on a published report, it appears here.
        </Empty>
      ) : null}
      <ul className="flex flex-col gap-4">
        {q.data?.reports.map((r) => (
          <li key={r.reference}>
            <Card>
              <h3 className="font-display text-lg font-bold">
                <Link to="/board/$ref" params={{ ref: r.reference }} className="underline">
                  Report <span className="font-mono">{r.reference}</span>
                </Link>
              </h3>
              {r.note ? <p className="whitespace-pre-wrap">{r.note}</p> : null}
              <ul className="flex flex-col gap-3 text-sm">
                {r.sources.map((s) => (
                  <li key={s.url} className="flex flex-col gap-1">
                    <span>
                      {s.title}
                      {s.publisher ? `, ${s.publisher}` : ''}
                      {s.published_on ? `, ${s.published_on}` : ''}
                    </span>
                    <CopyableLink url={s.url} />
                  </li>
                ))}
              </ul>
            </Card>
          </li>
        ))}
      </ul>
      {q.data ? (
        <Pagination
          page={q.data.page}
          pages={q.data.pages}
          label="Sources pages"
          onPage={setPage}
        />
      ) : null}
    </section>
  );
}
