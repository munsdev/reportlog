/**
 * The journalist desk (J9 to J11): a panel of sections, as the moderator's is.
 * /desk is the checked links, /desk/sources the moderators' Sources links on
 * published reports, /desk/alerts the journalist's own alert settings
 * (decision 47). The sidebar's "Journalist desk" group (staff-nav/entries.ts)
 * reaches each, and Account is the account page every signed-in person has.
 *
 * For a vetted journalist who has accepted the journalist agreement (the
 * gate below, then the server's own guard on every call). Read-only, a page
 * at a time, with nothing to download. Each list has a search box and, for a
 * journalist who chose alert states, a "My states" tick, and those are the
 * only filters (decision 72). They apply when the button is pressed, never
 * as the reader types, so the list does not change under them.
 *
 * Every link is text, never an anchor: the site never fetches one, and a
 * journalist copies it into a browser on purpose. Every page shown is in the
 * access log (J12).
 */
import { DESK_PAGE_SIZE, deskLinks, deskSources } from '@reportlog/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Alert } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { CheckOption } from '@/components/ui/choice.tsx';
import { Count } from '@/components/ui/count.tsx';
import { Empty } from '@/components/ui/empty.tsx';
import { Field } from '@/components/ui/field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { Pagination } from '@/components/ui/pagination.tsx';
import { plainSiteName, useSite } from '@/components/ui/site.tsx';
import { call } from '../../lib/api.ts';
import { StaffOnly } from '../identity/StaffOnly.tsx';
import { AgreementGate } from '../platform/Agreement.tsx';
import { DeskAlerts, deskQuery } from './AlertSettings.tsx';

/**
 * What every section shares: the role, the agreement before anything is
 * shown, the page, and the notes that apply to the whole desk.
 */
function DeskSection({
  title,
  lede,
  warn = true,
  children,
}: {
  title: string;
  lede: string;
  warn?: boolean;
  children: ReactNode;
}) {
  const siteName = plainSiteName(useSite().data);
  return (
    <StaffOnly needs="journalist">
      <AgreementGate audience="journalist">
        <StaffPage eyebrow={`${siteName} · Journalist desk`} title={title} lede={lede}>
          {warn ? (
            <Alert tone="warning" title="Before you use a link">
              A moderator checked each link, but did not verify what it shows. Treat it as a lead,
              not as a fact. Copying one is your choice: this site never opens it.
            </Alert>
          ) : null}
          {children}
          <p className="text-sm text-ink-alt">
            Every page you open here is recorded in the access log.
          </p>
        </StaffPage>
      </AgreementGate>
    </StaffOnly>
  );
}

export function DeskLinksPage() {
  return (
    <DeskSection title="Checked links" lede="Links from the tip line that a moderator has checked.">
      <CheckedLinks />
    </DeskSection>
  );
}

export function DeskSourcesPage() {
  return (
    <DeskSection
      title="Sources on published reports"
      lede="The sources moderators cite on published reports. Read only; nothing here is public."
    >
      <Sources />
    </DeskSection>
  );
}

export function DeskAlertsPage() {
  return (
    <DeskSection
      title="Your alerts"
      lede="Which states you get an email about, and whether alerts are on."
      warn={false}
    >
      <DeskAlerts />
    </DeskSection>
  );
}

interface Applied {
  q: string;
  mine: boolean;
}

/**
 * The search box and the "My states" tick above a list. Nothing is applied
 * until the button (or Enter) is pressed. The tick is offered only to a
 * journalist who has states, and the server reads those states itself.
 */
function useDeskFilter(onApply: () => void): { applied: Applied; box: ReactNode } {
  const settings = useQuery(deskQuery);
  const hasStates = settings.data?.state === 'open' && settings.data.states.length > 0;
  const [draft, setDraft] = useState<Applied>({ q: '', mine: false });
  const [applied, setApplied] = useState<Applied>({ q: '', mine: false });
  const box = (
    <form
      role="search"
      aria-label="Search this list"
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setApplied({ q: draft.q.trim(), mine: hasStates && draft.mine });
        // A new search starts at its first page.
        onApply();
      }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field className="sm:flex-1">
          <Label>Search</Label>
          <Input
            type="search"
            maxLength={100}
            value={draft.q}
            onChange={(e) => {
              setDraft({ ...draft, q: e.target.value });
            }}
          />
        </Field>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </div>
      {hasStates ? (
        <CheckOption
          label="My states"
          hint={`Only what is in the states you chose for alerts: ${settings.data?.state === 'open' ? settings.data.states.join(', ') : ''}.`}
          checked={draft.mine}
          onCheckedChange={(on) => {
            setDraft({ ...draft, mine: on === true });
          }}
        />
      ) : null}
    </form>
  );
  return { applied, box };
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
  const { applied, box } = useDeskFilter(() => {
    setPage(1);
  });
  const query = {
    page,
    ...(applied.q ? { q: applied.q } : {}),
    ...(applied.mine ? { mine: 'true' as const } : {}),
  };
  const q = useQuery({
    queryKey: ['desk', 'links', query],
    queryFn: ({ signal }) => call(deskLinks, { query, signal }),
    placeholderData: keepPreviousData,
    retry: false,
  });
  return (
    <section aria-label="Checked links" className="flex flex-col gap-4">
      {box}
      {q.isPending ? <p role="status">Loading…</p> : null}
      {q.isError ? <Alert tone="serious">{q.error.message}</Alert> : null}
      {q.data && !q.data.links.length ? (
        <Empty title={applied.q || applied.mine ? 'Nothing matches' : 'No checked links yet'}>
          {applied.q || applied.mine
            ? 'No checked link matches that search. Try other words, or clear the My states tick.'
            : 'When a moderator checks a link sent in a tip, it appears here.'}
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
  const { applied, box } = useDeskFilter(() => {
    setPage(1);
  });
  const query = {
    page,
    ...(applied.q ? { q: applied.q } : {}),
    ...(applied.mine ? { mine: 'true' as const } : {}),
  };
  const q = useQuery({
    queryKey: ['desk', 'sources', query],
    queryFn: ({ signal }) => call(deskSources, { query, signal }),
    placeholderData: keepPreviousData,
    retry: false,
  });
  return (
    <section aria-label="Sources on published reports" className="flex flex-col gap-4">
      {box}
      {q.isError ? <Alert tone="serious">{q.error.message}</Alert> : null}
      {q.data && !q.data.reports.length ? (
        <Empty title={applied.q || applied.mine ? 'Nothing matches' : 'No sources yet'}>
          {applied.q || applied.mine
            ? 'No source matches that search. A report with no place on it is left out of My states.'
            : 'When a moderator cites a source on a published report, it appears here.'}
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
