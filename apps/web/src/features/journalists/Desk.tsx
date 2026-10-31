/**
 * What a journalist adds to the board (decision 81, J9 to J11). There is no
 * desk to go to: /desk is a door (DeskDoor), the reports list carries the
 * moderators' Sources and notes, and the board has two more tabs for the
 * lists below, laid out like the reports: the checked links and the written
 * accounts.
 *
 * For a vetted journalist who has accepted the journalist agreement (the
 * gate, then the server's own guard on every call). Read-only, a page at a
 * time, with nothing to download. Each list has a search box and, for a
 * journalist who chose alert states, a "My states" tick, and those are the
 * only filters (decision 72). They apply when the button is pressed, never
 * as the reader types, so the list does not change under them.
 *
 * Every link is text, never an anchor: the site never fetches one, and a
 * journalist copies it into a browser on purpose. Every page shown is in the
 * access log (J12).
 */
import { DESK_PAGE_SIZE, deskLinks, deskTexts } from '@reportlog/contracts';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Navigate } from '@tanstack/react-router';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { StaffPage } from '@/features/nav/StaffPage.tsx';
import { plainSiteName, useSite } from '@/components/ui/site.tsx';
import { call } from '../../lib/api.ts';
import { Btn } from '@/mockup/Btn.tsx';
import { CheckBox } from '@/mockup/Field.tsx';
import { Chip } from '../../mockup/Chip.tsx';
import { Empty } from '../../mockup/Empty.tsx';
import { ErrorLine } from '../../mockup/ErrorLine.tsx';
import { Pager } from '../../mockup/Pager.tsx';
import { Panel } from '@/mockup/Panel.tsx';
import { StaffOnly } from '../identity/StaffOnly.tsx';
import { AgreementGate } from '../platform/Agreement.tsx';
import { deskQuery } from './AlertSettings.tsx';
import { DeskCard } from './Account.tsx';

/**
 * What a signed-in account without the role finds at the desk (decision 80):
 * where its request stands, or the one form to make it, instead of a refusal.
 */
function DeskApplication() {
  const siteName = plainSiteName(useSite().data);
  return (
    <StaffPage
      eyebrow={`${siteName} · Journalist access`}
      title="Journalist access"
      lede="Vetted journalists see more on the reports list: the moderators’ Sources and notes, the checked links, and search by their states. Ask for access here."
    >
      <DeskCard />
    </StaffPage>
  );
}

/**
 * /desk is only the door now (decision 81): the role, the agreement before
 * anything is shown, and then the reports list, where a journalist's extras
 * are. An account without the role finds where its request stands instead.
 */
export function DeskDoor() {
  return (
    <StaffOnly needs="journalist" otherwise={<DeskApplication />}>
      <AgreementGate audience="journalist">
        <Navigate to="/board" replace />
      </AgreementGate>
    </StaffOnly>
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
        <Btn sm flat type="submit">
          Search
        </Btn>
      </div>
      {hasStates ? (
        <CheckBox
          checked={draft.mine}
          title={`Only what is in the states you chose for alerts: ${settings.data?.state === 'open' ? settings.data.states.join(', ') : ''}.`}
          onChange={(e) => {
            setDraft({ ...draft, mine: e.target.checked });
          }}
        >
          My states
        </CheckBox>
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
export function CopyableLink({ url }: { url: string }) {
  const [said, setSaid] = useState<string | null>(null);
  return (
    <div className="copybox">
      <div className="row">
        <code>{url}</code>
        <Btn
          sm
          flat
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

export function CheckedLinks() {
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

export function Texts() {
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
