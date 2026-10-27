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
import { DESK_PAGE_SIZE, deskLinks, deskSources, deskTexts } from '@reportlog/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { plainSiteName, useSite } from '@/components/ui/site.tsx';
import { call } from '../../lib/api.ts';
import { Btn } from '../../mockup/Btn.tsx';
import { Check } from '../../mockup/Choices.tsx';
import { Chip } from '../../mockup/Chip.tsx';
import { Empty } from '../../mockup/Empty.tsx';
import { ErrorLine } from '../../mockup/ErrorLine.tsx';
import { Note } from '../../mockup/Note.tsx';
import { Pager } from '../../mockup/Pager.tsx';
import { Panel } from '../../mockup/Panel.tsx';
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
  notice,
  footer = 'Every page you open here is recorded in the access log.',
  children,
}: {
  title: string;
  lede: string;
  warn?: boolean;
  /** A different "before you use it" note, for a page that is not about links. */
  notice?: { title: string; body: string };
  footer?: string;
  children: ReactNode;
}) {
  const siteName = plainSiteName(useSite().data);
  return (
    <StaffOnly needs="journalist">
      <AgreementGate audience="journalist">
        <StaffPage eyebrow={`${siteName} · Journalist desk`} title={title} lede={lede}>
          {warn ? (
            <Note warn>
              <b>Before you use a link</b> A moderator checked each link, but did not verify what it
              shows. Treat it as a lead, not as a fact. Copying one is your choice: this site never
              opens it.
            </Note>
          ) : null}
          {notice ? (
            <Note warn>
              <b>{notice.title}</b> {notice.body}
            </Note>
          ) : null}
          {children}
          <p className="m">{footer}</p>
        </StaffPage>
      </AgreementGate>
    </StaffOnly>
  );
}

export function DeskLinksPage() {
  return (
    <DeskSection
      title="Checked links"
      lede="Links from the tip line and from reports that a moderator has checked. Read only; nothing here is public."
    >
      <CheckedLinks />
    </DeskSection>
  );
}

export function DeskTextsPage() {
  return (
    <DeskSection
      title="Written accounts"
      lede="Notes a moderator wrote from reporters' accounts, shared with the reporters' permission."
      warn={false}
      notice={{
        title: 'Before you use one',
        body: "Written by a moderator from a reporter's account. The reporter's own words are shown only where quoted. A note is not a verified fact, and reporters can take it back.",
      }}
      footer="Every page you open here is recorded in the access log. If a reporter erases or stops sharing an account, it disappears from here."
    >
      <Texts />
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
      className="toolbar"
      role="search"
      aria-label="Search this list"
      onSubmit={(e) => {
        e.preventDefault();
        setApplied({ q: draft.q.trim(), mine: hasStates && draft.mine });
        // A new search starts at its first page.
        onApply();
      }}
    >
      <div className="search grow">
        <input
          type="search"
          aria-label="Search"
          placeholder="Search"
          maxLength={100}
          value={draft.q}
          onChange={(e) => {
            setDraft({ ...draft, q: e.target.value });
          }}
        />
        <Btn type="submit">Search</Btn>
      </div>
      {hasStates ? (
        <Check
          checked={draft.mine}
          title={`Only what is in the states you chose for alerts: ${settings.data?.state === 'open' ? settings.data.states.join(', ') : ''}.`}
          onChange={(e) => {
            setDraft({ ...draft, mine: e.target.checked });
          }}
        >
          My states
        </Check>
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
    <div className="copybox">
      <div className="row">
        <code>{url}</code>
        <Btn
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
        </Btn>
        {said ? (
          <span role="status" className="m">
            {said}
          </span>
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
    <>
      {box}
      {q.isPending ? <p role="status">Loading…</p> : null}
      <ErrorLine error={q.error} />
      {q.data && !q.data.links.length ? (
        <Empty title={applied.q || applied.mine ? 'Nothing matches' : 'No checked links yet'}>
          {applied.q || applied.mine
            ? 'No checked link matches that search. Try other words, or clear the My states tick.'
            : 'When a moderator checks a link sent in a tip, it appears here.'}
        </Empty>
      ) : null}
      {q.data?.links.map((l) => (
        <Panel as="article" key={l.url} data-desk-link>
          <CopyableLink url={l.url} />
          <p className="m">
            <Chip>{l.tips === 1 ? 'Sent in 1 tip' : `Sent in ${String(l.tips)} tips`}</Chip>
            {l.reports ? (
              <>
                {' '}
                · shared in {String(l.reports)} {l.reports === 1 ? 'report' : 'reports'}
              </>
            ) : null}{' '}
            · checked {new Date(l.checked_at).toLocaleDateString()}
          </p>
          {l.comment ? (
            <p>
              <b>Moderator’s comment:</b> {l.comment}
            </p>
          ) : null}
          {l.context.length ? (
            <dl className="dl">
              {l.context.map((c) => (
                <div key={c.question}>
                  <dt>{c.question}</dt>
                  <dd>
                    {c.answers
                      .map((a) => (l.tips > 1 ? `${a.answer} (${String(a.tips)})` : a.answer))
                      .join(', ')}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </Panel>
      ))}
      {q.data ? (
        <Pager
          page={q.data.page}
          pages={q.data.pages}
          label="Checked links pages"
          onPage={setPage}
        />
      ) : null}
      <p className="m">{DESK_PAGE_SIZE} to a page.</p>
    </>
  );
}

function Texts() {
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
    queryKey: ['desk', 'texts', query],
    queryFn: ({ signal }) => call(deskTexts, { query, signal }),
    placeholderData: keepPreviousData,
    retry: false,
  });
  return (
    <>
      {box}
      <ErrorLine error={q.error} />
      {q.data && !q.data.texts.length ? (
        <Empty title={applied.q || applied.mine ? 'Nothing matches' : 'No written accounts yet'}>
          {applied.q || applied.mine
            ? 'No written account matches that search. Try other words, or clear the My states tick.'
            : 'When a moderator writes a note from an account and its reporter allows it, it appears here.'}
        </Empty>
      ) : null}
      {q.data?.texts.map((t) => (
        <Panel
          as="article"
          key={`${t.reference ?? 'tip'}-${t.checked_at}-${t.text.slice(0, 24)}`}
          data-desk-text
        >
          {/* Text, never a link out: nothing here fetches anything. */}
          <p style={{ whiteSpace: 'pre-wrap' }}>{t.text}</p>
          <p className="m">
            {t.reference ? <span className="mono">{t.reference}</span> : <span>Tip</span>}
            {t.place ? <> · {t.place}</> : null} · Note by a moderator
          </p>
        </Panel>
      ))}
      {q.data ? (
        <Pager
          page={q.data.page}
          pages={q.data.pages}
          label="Written accounts pages"
          onPage={setPage}
        />
      ) : null}
    </>
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
    <>
      {box}
      <ErrorLine error={q.error} />
      {q.data && !q.data.reports.length ? (
        <Empty title={applied.q || applied.mine ? 'Nothing matches' : 'No sources yet'}>
          {applied.q || applied.mine
            ? 'No source matches that search. A report with no place on it is left out of My states.'
            : 'When a moderator cites a source on a published report, it appears here.'}
        </Empty>
      ) : null}
      {q.data?.reports.map((r) => (
        <Panel as="article" key={r.reference}>
          <Link className="mono" to="/board/$ref" params={{ ref: r.reference }}>
            {r.reference}
          </Link>
          {r.note ? <p style={{ whiteSpace: 'pre-wrap' }}>{r.note}</p> : null}
          {r.sources.map((s) => (
            <div key={s.url}>
              <p className="m">
                {s.title}
                {s.publisher ? `, ${s.publisher}` : ''}
                {s.published_on ? `, ${s.published_on}` : ''}
              </p>
              <CopyableLink url={s.url} />
            </div>
          ))}
        </Panel>
      ))}
      {q.data ? (
        <Pager page={q.data.page} pages={q.data.pages} label="Sources pages" onPage={setPage} />
      ) : null}
    </>
  );
}
